class VideoConference {
    constructor() {
        this.localStream = null;
        this.screenStream = null;
        this.isScreenSharing = false;
        this.ws = null;
        this.peers = new Map();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;

        // DOM elements
        this.localVideo = document.getElementById('local-video');
        this.videoGrid = document.getElementById('video-grid');
        this.cameraBtn = document.getElementById('camera-btn');
        this.micBtn = document.getElementById('mic-btn');
        this.screenBtn = document.getElementById('screen-btn');
        this.joinBtn = document.getElementById('join-btn');
        this.roomInput = document.getElementById('room-id');
        this.statusElement = document.getElementById('status');

        // WebRTC configuration
        this.configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        this.initializeEventListeners();
        this.initializeWebSocket();
    }

    initializeWebSocket() {
        // Use your deployed WebSocket server URL here
        const wsUrl = 'wss://your-server-url.onrender.com';
        
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.close();
        }

        this.ws = new WebSocket(wsUrl);

        this.ws.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            
            switch (data.type) {
                case 'user-joined':
                    await this.handleUserJoined(data.userId, data.roomId);
                    break;
                case 'user-left':
                    this.handleUserLeft(data.userId);
                    break;
                case 'offer':
                    await this.handleOffer(data);
                    break;
                case 'answer':
                    await this.handleAnswer(data);
                    break;
                case 'ice-candidate':
                    await this.handleIceCandidate(data);
                    break;
            }
        };

        this.ws.onopen = () => {
            this.updateStatus('Connected to server');
            this.reconnectAttempts = 0;
            this.joinBtn.disabled = false;
        };

        this.ws.onerror = (error) => {
            this.updateStatus('Connection error. Retrying...');
            this.joinBtn.disabled = true;
        };

        this.ws.onclose = () => {
            this.joinBtn.disabled = true;
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
                this.updateStatus(`Connection lost. Reconnecting in ${delay/1000} seconds...`);
                setTimeout(() => this.initializeWebSocket(), delay);
            } else {
                this.updateStatus('Unable to connect to server. Please refresh the page to try again.');
            }
        };
    }

    async initializeEventListeners() {
        this.cameraBtn.addEventListener('click', () => this.toggleTrack('video'));
        this.micBtn.addEventListener('click', () => this.toggleTrack('audio'));
        this.screenBtn.addEventListener('click', () => this.toggleScreenShare());
        this.joinBtn.addEventListener('click', () => this.joinRoom());

        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            this.localVideo.srcObject = this.localStream;
            this.updateStatus('Camera and microphone accessed successfully');
        } catch (error) {
            this.updateStatus('Error accessing media devices: ' + error.message);
        }
    }

    createVideoElement(userId) {
        const container = document.createElement('div');
        container.className = 'video-container';
        container.id = `container-${userId}`;

        const video = document.createElement('video');
        video.id = `video-${userId}`;
        video.autoplay = true;
        video.playsInline = true;

        container.appendChild(video);
        this.videoGrid.appendChild(container);
        return video;
    }

    async handleUserJoined(userId, roomId) {
        if (!this.peers.has(userId)) {
            const peerConnection = new RTCPeerConnection(this.configuration);
            this.setupPeerConnectionHandlers(peerConnection, userId, roomId);
            this.peers.set(userId, peerConnection);

            // Add local tracks to the peer connection
            this.localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, this.localStream);
            });

            // Create and send offer
            try {
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                this.ws.send(JSON.stringify({
                    type: 'offer',
                    offer: offer,
                    roomId: roomId,
                    userId: userId
                }));
            } catch (error) {
                this.updateStatus('Error creating offer: ' + error.message);
            }
        }
    }

    handleUserLeft(userId) {
        const peerConnection = this.peers.get(userId);
        if (peerConnection) {
            peerConnection.close();
            this.peers.delete(userId);
        }

        const container = document.getElementById(`container-${userId}`);
        if (container) {
            container.remove();
        }
    }

    async joinRoom() {
        const roomId = this.roomInput.value;
        if (!roomId) {
            this.updateStatus('Please enter a room ID');
            return;
        }

        if (this.ws.readyState !== WebSocket.OPEN) {
            this.updateStatus('Not connected to server. Please wait...');
            return;
        }

        try {
            // Send join message to signaling server
            this.ws.send(JSON.stringify({
                type: 'join',
                roomId: roomId
            }));

            this.updateStatus('Joined room: ' + roomId);
            this.joinBtn.disabled = true;
        } catch (error) {
            this.updateStatus('Error joining room: ' + error.message);
        }
    }

    setupPeerConnectionHandlers(peerConnection, userId, roomId) {
        peerConnection.ontrack = (event) => {
            const video = document.getElementById(`video-${userId}`) || this.createVideoElement(userId);
            if (video.srcObject !== event.streams[0]) {
                video.srcObject = event.streams[0];
            }
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.ws.send(JSON.stringify({
                    type: 'ice-candidate',
                    roomId: roomId,
                    userId: userId,
                    candidate: event.candidate
                }));
            }
        };

        peerConnection.onconnectionstatechange = () => {
            if (peerConnection.connectionState === 'disconnected') {
                this.handleUserLeft(userId);
            }
        };
    }

    async handleOffer(data) {
        try {
            if (!this.peers.has(data.userId)) {
                const peerConnection = new RTCPeerConnection(this.configuration);
                this.setupPeerConnectionHandlers(peerConnection, data.userId, data.roomId);
                this.peers.set(data.userId, peerConnection);

                // Add local tracks
                this.localStream.getTracks().forEach(track => {
                    peerConnection.addTrack(track, this.localStream);
                });
            }

            const peerConnection = this.peers.get(data.userId);
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            this.ws.send(JSON.stringify({
                type: 'answer',
                roomId: data.roomId,
                userId: data.userId,
                answer: answer
            }));
        } catch (error) {
            this.updateStatus('Error handling offer: ' + error.message);
        }
    }

    async handleAnswer(data) {
        try {
            const peerConnection = this.peers.get(data.userId);
            if (peerConnection) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            }
        } catch (error) {
            this.updateStatus('Error handling answer: ' + error.message);
        }
    }

    async handleIceCandidate(data) {
        try {
            const peerConnection = this.peers.get(data.userId);
            if (peerConnection) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        } catch (error) {
            this.updateStatus('Error handling ICE candidate: ' + error.message);
        }
    }

    async toggleTrack(kind) {
        const tracks = this.localStream.getTracks().filter(track => track.kind === kind);
        const button = kind === 'video' ? this.cameraBtn : this.micBtn;

        tracks.forEach(track => {
            track.enabled = !track.enabled;
            button.classList.toggle('active');
            button.textContent = `Toggle ${kind.charAt(0).toUpperCase() + kind.slice(1)} ${track.enabled ? 'Off' : 'On'}`;
        });
    }

    async toggleScreenShare() {
        try {
            if (!this.isScreenSharing) {
                this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                const videoTrack = this.screenStream.getVideoTracks()[0];

                // Replace video track in all peer connections
                this.peers.forEach(peerConnection => {
                    const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
                    if (sender) {
                        sender.replaceTrack(videoTrack);
                    }
                });

                this.localVideo.srcObject = this.screenStream;
                this.screenBtn.textContent = 'Stop Sharing';
                this.screenBtn.classList.add('active');
                this.isScreenSharing = true;

                videoTrack.onended = () => {
                    this.stopScreenSharing();
                };
            } else {
                this.stopScreenSharing();
            }
        } catch (error) {
            this.updateStatus('Error sharing screen: ' + error.message);
        }
    }

    async stopScreenSharing() {
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(track => track.stop());
            
            // Restore camera video track in all peer connections
            const videoTrack = this.localStream.getVideoTracks()[0];
            this.peers.forEach(peerConnection => {
                const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
                if (sender) {
                    sender.replaceTrack(videoTrack);
                }
            });

            this.localVideo.srcObject = this.localStream;
            this.screenBtn.textContent = 'Share Screen';
            this.screenBtn.classList.remove('active');
            this.isScreenSharing = false;
        }
    }

    updateStatus(message) {
        this.statusElement.textContent = message;
    }
}

// Initialize the application
window.addEventListener('load', () => {
    new VideoConference();
});