"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { ChatMessageType } from "@/components/chat/ChatTile";
import { TranscriptionTile } from "@/transcriptions/TranscriptionTile";
// If we need to extend the ChatMessageType for errors, we can define it here:
interface ExtendedChatMessageType extends ChatMessageType {
    isError?: boolean;
}
import {
    useConnectionState,
    useLocalParticipant,
    useVoiceAssistant,
    useChat,
    useDataChannel,
    useTrackTranscription
} from "@livekit/components-react";
import { ConnectionState, DataPacket_Kind, Track, RpcInvocationData } from "livekit-client";
import { ReactNode } from "react";
import { API_BASE_URL } from '@/config';
import { api } from '@/api';
import { jwtDecode } from "jwt-decode";
import { MobileVideoPlayer } from './mobile/MobileVideoPlayer';
import { MobileProgressBar } from './mobile/MobileProgressBar';
import { MessageSquare, ClipboardList, User, Radio, Share2, Square, Send, Mic, MicOff, Plus, Edit2, Trash2, ChevronRight, Save, Info, Lock, Globe, Copy, Check, ExternalLink, Volume2, VolumeX, X, Loader2, Play, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Our EngagementOpportunity interface definition
interface EngagementQuizItem {
    options?: string[];
    question: string;
    follow_up?: {
        if_correct?: string;
        if_incorrect?: string;
    };
    explanation?: string;
    question_type: 'multiple_choice' | 'short_answer' | 'discussion';
    correct_option?: string | null;
    expected_answer?: string | null;
    alternative_phrasings?: string[];
}

export interface EngagementOpportunity {
    id: string;
    rationale: string;
    timestamp: string;
    quiz_items: EngagementQuizItem[];
    section_id: string;
    engagement_type: 'quiz' | 'discussion';
    concepts_addressed: string[];
}

// Keep these interfaces as they are essential
export interface PlaygroundProps {
    logo?: ReactNode;
    themeColors: string[];
    onConnect: (connect: boolean, opts?: { token: string; url: string }) => void;
    agentType?: 'edit' | 'view';
    userId?: string;
    brdgeId?: string | null;
    authToken?: string | null;
}

// Define an interface for the data channel to avoid TypeScript errors
interface DataChannelWithEvents {
    on: (event: string, callback: (message: any) => void) => void;
    off: (event: string, callback: (message: any) => void) => void;
}

interface SavedVoice {
    id: string;
    name: string;
    created_at: string;
    status: string;
    brdge_id?: string | number;
    language?: string;
    description?: string;
}

interface EnhancedVoice extends SavedVoice {
    brdge_name?: string;
    is_from_current_bridge?: boolean;
}

interface Brdge {
    id: number;
    name: string;
    presentation_filename: string;
    audio_filename: string;
    folder: string;
    user_id: number;
    shareable: boolean;
    public_id: string | null;
    voice_id?: string | null;
    agent_personality?: string;
}

// --- Copied Helper Functions from Playground.tsx ---
// (Simplified versions suitable for mobile context if needed)
const formatVideoTime = (timestamp: string): string => {
    if (!timestamp || !timestamp.startsWith('00:')) return '0:00';
    return timestamp.substring(3);
};

const getEngagementTypeIcon = (type: string) => {
    // Simplified icon logic for brevity, could use Lucide icons
    switch (type) {
        case 'quiz': return <ClipboardList size={16} className="text-blue-500" />;
        case 'discussion': return <MessageSquare size={16} className="text-green-500" />;
        default: return null;
    }
};

const getQuestionTypeIcon = (type: string) => {
    switch (type) {
        case 'multiple_choice': return <Check size={16} className="text-purple-500" />;
        case 'short_answer': return <Edit2 size={16} className="text-orange-500" />;
        case 'discussion': return <MessageSquare size={16} className="text-green-500" />;
        default: return null;
    }
};

// Debounce utility
const useDebounce = (callback: Function, delay: number) => {
    const timeoutRef = useRef<NodeJS.Timeout>();

    return useCallback((...args: any[]) => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        timeoutRef.current = setTimeout(() => {
            callback(...args);
        }, delay);
    }, [callback, delay]);
};
// --- End Copied Helper Functions ---

export default function PlaygroundMobile({
    logo,
    themeColors,
    onConnect,
    agentType,
    userId,
    brdgeId,
    authToken
}: PlaygroundProps) {
    // Copy essential state variables
    const [params, setParams] = useState({
        brdgeId: null as string | null,
        apiBaseUrl: null as string | null,
        coreApiUrl: API_BASE_URL,
        userId: null as string | null,
        agentType: 'edit' as 'edit' | 'view'
    });

    // Add roomName state 
    const [roomName, setRoomName] = useState<string | null>(null);

    // Copy video-related state
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [currentTime, setCurrentTime] = useState(0);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [isVideoReadyForListeners, setIsVideoReadyForListeners] = useState(false);

    // Chat state
    const [transcripts, setTranscripts] = useState<ExtendedChatMessageType[]>([]);

    // LiveKit integrations
    const { localParticipant } = useLocalParticipant();
    const voiceAssistant = useVoiceAssistant();
    const roomState = useConnectionState();
    const chat = useChat();
    const dataChannel = useDataChannel();
    const { send: sendVideoTimestamp } = useDataChannel("video-timestamp");

    // Reference for auto-scrolling chat
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Add engagementOpportunities state
    const [engagementOpportunities, setEngagementOpportunities] = useState<EngagementOpportunity[]>([]);

    // Add MobileTab state for navigation
    const [activeMobileTab, setActiveMobileTab] = useState<'chat' | 'engagement' | 'teaching-persona' | 'voice-clone' | 'share'>('chat');

    // Add component mount state tracking
    const isMounted = useRef(false);

    // Add state for interrupt button animation
    const [interruptPressed, setInterruptPressed] = useState(false);
    const [animateInterrupt, setAnimateInterrupt] = useState(false);

    // Add state for message text input
    const [messageText, setMessageText] = useState('');

    // Add state for other tabs
    const [agentConfig, setAgentConfig] = useState<any>(null); // Simplified type for now
    const [teachingPersona, setTeachingPersona] = useState<any>(null);
    const [savedVoices, setSavedVoices] = useState<EnhancedVoice[]>([]);
    const [userVoices, setUserVoices] = useState<EnhancedVoice[]>([]);
    const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
    const [selectedVoiceBrdgeId, setSelectedVoiceBrdgeId] = useState<string | null>(null);
    const [isCreatingVoice, setIsCreatingVoice] = useState(false);
    const [brdge, setBrdge] = useState<Brdge | null>(null);
    const [shareableLink, setShareableLink] = useState('');
    const [isCopied, setIsCopied] = useState(false);
    const [isSaving, setIsSaving] = useState(false); // For persona save
    const [saveSuccess, setSaveSuccess] = useState(false); // For persona save
    const [phrasesText, setPhrasesText] = useState(''); // For persona phrases
    const [selectedEngagementType, setSelectedEngagementType] = useState<string | null>(null); // For filtering engagements

    // Add initialization state
    const [isInitializing, setIsInitializing] = useState(true);

    // Add handleInterruptAgent function
    const handleInterruptAgent = useCallback(() => {
        if (roomState !== ConnectionState.Connected || !dataChannel) {
            console.warn("Cannot interrupt agent: room not connected or dataChannel unavailable");
            return;
        }

        try {
            const interruptMessage = {
                type: "interrupt",
                timestamp: Date.now()
            };

            const payload = new TextEncoder().encode(JSON.stringify(interruptMessage));

            dataChannel.send(payload, {
                topic: "agent-control",
                reliable: true
            });

            // Enhanced visual feedback
            setInterruptPressed(true);
            setAnimateInterrupt(true);

            // Reset states after animations complete
            setTimeout(() => setInterruptPressed(false), 400);
            setTimeout(() => setAnimateInterrupt(false), 600);

            console.log("Sent interrupt command to agent");
        } catch (error) {
            console.error("Failed to send interrupt command:", error);
        }
    }, [roomState, dataChannel]);

    // Scroll to bottom function for chat
    const scrollToBottom = useCallback(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, []);

    // Auto-scroll when messages change
    useEffect(() => {
        scrollToBottom();
    }, [transcripts, scrollToBottom]);

    // URL params handling
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const urlParams = new URLSearchParams(window.location.search);
            const token = urlParams.get('token') || authToken;

            const newParams = {
                brdgeId: urlParams.get('brdgeId') || brdgeId || null,
                apiBaseUrl: urlParams.get('apiBaseUrl'),
                coreApiUrl: API_BASE_URL,
                userId: token ?
                    jwtDecode<{ sub: string }>(token).sub :
                    userId || `anon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                agentType: (urlParams.get('agentType') as 'edit' | 'view') || agentType || 'edit'
            };

            setParams(newParams);
        }
    }, [authToken, brdgeId, userId, agentType]);

    // Video URL fetching
    const fetchVideoUrl = useCallback(async () => {
        if (!params.brdgeId || !params.apiBaseUrl) return;

        try {
            const headers: HeadersInit = {};
            if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
            const response = await fetch(`${params.apiBaseUrl}/brdges/${params.brdgeId}/recordings/latest/signed-url`, { headers });
            if (!response.ok) throw new Error('Failed to fetch video URL');

            const { url } = await response.json();
            setVideoUrl(url);
            // Consider initialization complete when video URL is fetched (or combine with other fetches)
            // setIsInitializing(false); // We will set this after Brdge data is also fetched
        } catch (error) {
            console.error('Error fetching video URL:', error);
            setIsInitializing(false); // Stop loading even on error
        }
    }, [params.brdgeId, params.apiBaseUrl, authToken]);

    useEffect(() => {
        fetchVideoUrl();
    }, [fetchVideoUrl]);

    // Update the fetchEngagementOpportunities function to use agent-config endpoint
    const fetchEngagementOpportunities = useCallback(async () => {
        if (!params.brdgeId || !params.apiBaseUrl) return;

        try {
            console.log('Fetching agent config...');
            const response = await fetch(`${params.apiBaseUrl}/brdges/${params.brdgeId}/agent-config`);
            if (!response.ok) {
                console.warn('Failed to fetch agent config');
                return;
            }

            const data = await response.json();
            console.log('Received agent config:', data);

            if (data.engagement_opportunities) {
                console.log('Setting engagement opportunities from agent config:', data.engagement_opportunities);
                console.log('Number of opportunities:', data.engagement_opportunities.length);
                setEngagementOpportunities(data.engagement_opportunities);
            } else {
                console.log('No engagement opportunities found in agent config');
                setEngagementOpportunities([]);
            }
        } catch (error) {
            console.error('Error fetching agent config:', error);
        }
    }, [params.brdgeId, params.apiBaseUrl]);

    // Call it when params change
    useEffect(() => {
        fetchEngagementOpportunities();
    }, [fetchEngagementOpportunities]);

    // Define the onDataReceived callback using useCallback
    const onDataReceived = useCallback((msg: any) => {
        try {
            if (!msg.payload) {
                console.warn("Received empty message payload");
                return;
            }

            const decodedText = new TextDecoder().decode(msg.payload);
            if (!decodedText) {
                console.warn("Empty decoded text from message payload");
                return;
            }

            let decoded;
            try {
                decoded = JSON.parse(decodedText);
            } catch (e) {
                console.error("Failed to parse message JSON:", e);
                return;
            }

            console.log("Received message:", msg.topic, decoded);

            if (msg.topic === "transcription") {
                const timestamp = decoded.timestamp > 0 ? decoded.timestamp : Date.now();

                setTranscripts(prev => [...prev, {
                    name: "You",
                    message: decoded.text,
                    timestamp: timestamp,
                    isSelf: true,
                } as ExtendedChatMessageType]);
            } else if (msg.topic === "chat") {
                setTranscripts(prev => [...prev, {
                    name: "Assistant",
                    message: decoded.message || decoded.text || "No message content", // Handle different message formats
                    timestamp: Date.now(),
                    isSelf: false,
                } as ExtendedChatMessageType]);
            }
        } catch (error) {
            console.error("Error processing message:", error);
        }
    }, []);

    // Use the dataChannel hook directly with the callback
    useDataChannel(onDataReceived);

    // Chat message handling
    const handleChatMessage = async (message: string) => {
        if (!chat) {
            console.warn("Chat functionality not available");
            return;
        }

        if (!message.trim()) {
            console.warn("Attempted to send empty message");
            return;
        }

        const newMessage: ExtendedChatMessageType = {
            name: "You",
            message,
            isSelf: true,
            timestamp: Date.now(),
        };

        setTranscripts(prev => [...prev, newMessage]);

        try {
            await chat.send(message);
            console.log("Chat message sent:", message);
        } catch (error) {
            console.error("Error sending chat message:", error);

            // Now using ExtendedChatMessageType for error messages
            setTranscripts(prev => [...prev, {
                name: "System",
                message: "Failed to send message. Please try again.",
                isSelf: false,
                timestamp: Date.now(),
                isError: true,
            } as ExtendedChatMessageType]);
        }
    };

    // LiveKit connection - connect once when brdgeId becomes available
    // useEffect(() => {
    //     // Only attempt connection if we have the necessary IDs and are disconnected
    //     const canAutoConnect = params.userId && params.brdgeId;
    //     if (canAutoConnect && roomState === ConnectionState.Disconnected) {
    //         console.log("Mobile: Attempting auto-connect based on params and state.");
    //         onConnect(true);
    //     }
    // }, [params.userId, params.brdgeId, roomState, onConnect]); // Depend on roomState too

    // Log connection state changes
    useEffect(() => {
        console.log('Mobile LiveKit connection state:', roomState);

        if (roomState === ConnectionState.Connected) {
            console.log('Successfully connected to LiveKit room');
        } else if (roomState === ConnectionState.Disconnected) {
            console.log('Disconnected from LiveKit room');
        } else if (roomState === ConnectionState.Connecting) {
            console.log('Connecting to LiveKit room...');
        } else if (roomState === ConnectionState.Reconnecting) {
            console.log('Reconnecting to LiveKit room...');
        }
    }, [roomState]);

    // Add time-seeking functionality for engagement markers
    const seekToTime = useCallback((timestamp: string) => {
        if (!videoRef.current) return;

        // Helper function to convert timestamp (00:00:00) to seconds
        const timestampToSeconds = (timestamp: string): number => {
            if (!timestamp) return 0;

            const parts = timestamp.split(':');
            if (parts.length === 3) {
                return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
            } else if (parts.length === 2) {
                return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
            }
            return 0;
        };

        const seconds = timestampToSeconds(timestamp);
        if (seconds > 0 && seconds <= videoRef.current.duration) {
            videoRef.current.currentTime = seconds;
            setCurrentTime(seconds);
            console.log(`Seeking to timestamp: ${timestamp} (${seconds}s)`);
        }
    }, [videoRef]);

    // Setup proper cleanup on component unmount
    useEffect(() => {
        isMounted.current = true;

        // Cleanup function to disconnect when component unmounts
        return () => {
            isMounted.current = false;
            // --- REMOVE explicit disconnect ---
            // Only disconnect if we previously connected
            // if (hasConnected.current) {
            //   console.log("Disconnecting from LiveKit on unmount");
            //   onConnect(false);
            // }
            // --- END REMOVAL ---
        };
    }, []); // Empty dependency array means this only runs on mount/unmount

    // --- ADD handleConnect function ---
    const handleConnect = useCallback(async () => {
        if (roomState === ConnectionState.Connected) {
            console.log("Mobile: Manually disconnecting.");
            onConnect(false);
        } else if (roomState === ConnectionState.Disconnected || roomState === ConnectionState.Reconnecting) {
            // Allow connection attempt if disconnected or trying to reconnect
            console.log("Mobile: Manually connecting.");
            onConnect(true);
        } else {
            console.log(`Mobile: Cannot manually connect/disconnect in state: ${roomState}`);
        }
    }, [roomState, onConnect]);

    const lastSentTimestampRef = useRef<number | null>(null);

    useEffect(() => {
        if (!localParticipant || roomState !== ConnectionState.Connected) {
            return; // Don't register if not connected or no participant
        }

        console.log("Registering mobile player-control RPC method");

        const rpcHandler = async (data: RpcInvocationData) => {
            try {
                console.log(`Received mobile player control from agent: ${data.payload}`);
                const command = JSON.parse(data.payload);

                if (videoRef.current) {
                    if (command.action === 'pause') {
                        videoRef.current.pause();
                        setIsPlaying(false); // Update mobile state
                        console.log("Mobile video paused via RPC");
                        return JSON.stringify({ success: true, action: 'pause' });
                    } else if (command.action === 'play') {
                        await videoRef.current.play(); // Use await for play()
                        setIsPlaying(true); // Update mobile state
                        console.log("Mobile video resumed via RPC");
                        return JSON.stringify({ success: true, action: 'play' });
                    }
                }
                return JSON.stringify({ success: false, error: 'Invalid command or video ref missing' });
            } catch (error) {
                console.error('Error handling mobile player control RPC:', error);
                return JSON.stringify({ success: false, error: String(error) });
            }
        };

        // Register the RPC method
        localParticipant.registerRpcMethod(
            'controlVideoPlayer', // Keep the same name
            rpcHandler
        );

        // Cleanup function
        return () => {
            try {
                // Check if participant still exists before unregistering
                if (localParticipant) {
                    localParticipant.unregisterRpcMethod('controlVideoPlayer');
                    console.log("Unregistered mobile player-control RPC method");
                }
            } catch (error) {
                console.error("Error unregistering mobile RPC method:", error);
            }
        };
    }, [localParticipant, roomState, videoRef, setIsPlaying]); // Use mobile state variables

    const sendTimestamp = useCallback(() => {
        const currentVideo = videoRef.current;
        const sendFn = sendVideoTimestamp; // Use the specific send function
        const currentState = roomState;

        if (!currentVideo) {
            // console.log("sendTimestamp aborted: Video ref is missing."); // Optional logging
            return;
        }
        if (currentState !== ConnectionState.Connected) {
            // console.log(`sendTimestamp aborted: Room not connected (State: ${currentState}).`); // Optional logging
            return;
        }

        const currentTime = currentVideo.currentTime;
        const thresholdMet = lastSentTimestampRef.current === null ||
            Math.abs(currentTime - lastSentTimestampRef.current) >= 0.7; // 700ms threshold

        if (thresholdMet) {
            const message = JSON.stringify({
                type: "timestamp",
                time: currentTime
            });
            const payload = new TextEncoder().encode(message);

            try {
                if (sendFn) {
                    sendFn(payload, { topic: "video-timestamp", reliable: false });
                    lastSentTimestampRef.current = currentTime;
                    // console.log(`Timestamp ${currentTime} sent.`); // Optional logging
                } else {
                    // console.log("Cannot send timestamp: send function is not available."); // Optional logging
                }
            } catch (err) {
                console.error(`Failed to send timestamp ${currentTime}:`, err);
            }
        }
    }, [roomState, sendVideoTimestamp]); // Dependencies for useCallback

    const handlePlay = useCallback(() => {
        console.log("Mobile video play event triggered");
        sendTimestamp(); // Send initial timestamp on play
    }, [sendTimestamp]);

    const handleStop = useCallback(() => {
        // No timestamp action needed on stop/pause/end based on Playground.tsx logic
        console.log("Mobile video stop/pause/ended event triggered");
    }, []);

    const handleSeeked = useCallback(() => {
        console.log("Mobile video seeked event triggered");
        sendTimestamp(); // Send timestamp immediately after seek
    }, [sendTimestamp]);

    useEffect(() => {
        const video = videoRef.current;

        // Only attach listeners if video element exists, room is connected, AND video is ready
        if (!video || roomState !== ConnectionState.Connected || !isVideoReadyForListeners) {
            console.log(`Mobile listeners check failed: Video ${video ? 'exists' : 'missing'}, State: ${roomState}, Ready: ${isVideoReadyForListeners}. Not attaching.`);
            return;
        }

        console.log("Mobile listeners: Attaching video event listeners.");

        // Define local handlers referencing the stable useCallback versions
        const onPlay = () => handlePlay();
        const onPause = () => handleStop();
        const onEnded = () => handleStop();
        const onSeeked = () => handleSeeked();
        const onTimeUpdate = () => sendTimestamp(); // Directly call the stable sendTimestamp

        // Add listeners
        video.addEventListener("play", onPlay);
        video.addEventListener("pause", onPause);
        video.addEventListener("ended", onEnded);
        video.addEventListener("seeked", onSeeked);
        video.addEventListener("timeupdate", onTimeUpdate); // Add timeupdate listener

        console.log("Mobile listeners: Event listeners attached.");

        // Cleanup function
        return () => {
            console.log("Mobile listeners cleanup: Removing video event listeners.");
            if (video) {
                video.removeEventListener("play", onPlay);
                video.removeEventListener("pause", onPause);
                video.removeEventListener("ended", onEnded);
                video.removeEventListener("seeked", onSeeked);
                video.removeEventListener("timeupdate", onTimeUpdate); // Remove timeupdate listener
            }
        };
    }, [roomState, isVideoReadyForListeners, handlePlay, handleStop, handleSeeked, sendTimestamp]); // Dependencies

    // Fetch Agent Config (includes teaching_persona and engagement_opportunities)
    const fetchAgentConfig = useCallback(async () => {
        if (!params.brdgeId || !params.apiBaseUrl) return;
        try {
            const headers: HeadersInit = {};
            if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
            const response = await fetch(`${params.apiBaseUrl}/brdges/${params.brdgeId}/agent-config`, { headers });
            if (!response.ok) throw new Error('Failed to fetch agent config');
            const data = await response.json();
            setAgentConfig(data);
            setTeachingPersona(data.teaching_persona || {}); // Initialize teachingPersona
            setEngagementOpportunities(data.engagement_opportunities || []); // Initialize engagements
        } catch (error) {
            console.error('Error fetching agent config:', error);
        }
    }, [params.brdgeId, params.apiBaseUrl, authToken]);

    useEffect(() => {
        fetchAgentConfig();
    }, [fetchAgentConfig]);

    // Fetch Brdge Data (includes shareable status and voice_id)
    const fetchBrdge = useCallback(async () => {
        if (!params.brdgeId || !params.apiBaseUrl) {
            setIsInitializing(false); // Cannot initialize without these params
            return;
        }
        setIsInitializing(true); // Start loading when fetching brdge
        try {
            const headers: HeadersInit = {};
            if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
            const response = await fetch(`${params.apiBaseUrl}/brdges/${params.brdgeId}`, { headers, credentials: 'omit' });
            if (!response.ok) throw new Error('Failed to fetch brdge');
            const data = await response.json();
            setBrdge(data);
            if (data.voice_id) {
                setSelectedVoice(data.voice_id);
                setSelectedVoiceBrdgeId(String(params.brdgeId));
            } else {
                setSelectedVoice("default");
                setSelectedVoiceBrdgeId(null);
            }
            // Now that brdge data is fetched, and assuming video URL is also fetched or fetching initiated, stop initializing
            setIsInitializing(false);
        } catch (error) {
            console.error('Error fetching brdge:', error);
            setIsInitializing(false); // Stop loading on error
        }
    }, [params.brdgeId, params.apiBaseUrl, authToken]);

    useEffect(() => {
        fetchBrdge();
    }, [fetchBrdge]);

    // Update Shareable Link when brdge data changes
    const updateShareableLink = useCallback((isShareable: boolean) => {
        if (!brdge || !isShareable) {
            setShareableLink('');
            return;
        }
        let baseUrl = window.location.origin;
        if (baseUrl.includes('localhost:3001')) {
            baseUrl = baseUrl.replace('3001', '3000');
        }
        const shareUrl = `${baseUrl}/viewBridge/${brdge.id}-${brdge.public_id?.substring(0, 6)}`;
        setShareableLink(shareUrl);
    }, [brdge]);

    useEffect(() => {
        if (brdge) {
            updateShareableLink(brdge.shareable);
        }
    }, [brdge, updateShareableLink]);

    // Fetch Saved Voices
    const fetchVoices = useCallback(async () => {
        if (!params.brdgeId || !params.apiBaseUrl) return;
        try {
            const headers: HeadersInit = {};
            if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
            const response = await fetch(`${params.apiBaseUrl}/brdges/${params.brdgeId}/voices`, { headers, credentials: 'omit' });
            if (!response.ok) throw new Error('Failed to fetch voices');
            const data = await response.json();
            setSavedVoices(data.voices || []);
        } catch (error) {
            console.error('Error loading voices:', error);
        }
    }, [params.brdgeId, params.apiBaseUrl, authToken]);

    useEffect(() => {
        fetchVoices();
    }, [fetchVoices]);

    // --- Config Update Logic ---
    const debouncedUpdateConfig = useDebounce((newConfig: any) => {
        updateAgentConfigBackend(newConfig);
    }, 1000); // Debounce time

    const updateAgentConfigBackend = async (newConfig: any) => {
        if (!params.brdgeId || !params.apiBaseUrl) return;
        console.log('Updating config on backend:', newConfig);
        setIsSaving(true); // Indicate saving starts
        try {
            const response = await fetch(
                `${params.apiBaseUrl}/brdges/${params.brdgeId}/agent-config`,
                {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
                    },
                    body: JSON.stringify(newConfig),
                }
            );
            if (response.ok) {
                console.log('Backend config updated successfully.');
                setSaveSuccess(true);
                setTimeout(() => setSaveSuccess(false), 2000);
            } else {
                console.error(`Failed to update backend config: ${response.status} ${response.statusText}`);
                const errorBody = await response.text();
                console.error('Error response body:', errorBody);
                alert('Failed to save configuration.');
            }
        } catch (error) {
            console.error('Error updating backend config:', error);
            alert('An error occurred while saving.');
        } finally {
            setIsSaving(false); // Indicate saving finished
        }
    };

    // Helper function to update nested properties in teaching persona
    const updateTeachingPersonaField = (path: string, value: any) => {
        setTeachingPersona((prev: any) => {
            const newPersona = { ...(prev || {}) }; // Handle null initial state
            const keys = path.split('.');
            let current: any = newPersona;
            for (let i = 0; i < keys.length - 1; i++) {
                if (!current[keys[i]]) current[keys[i]] = {};
                current = current[keys[i]];
            }
            current[keys[keys.length - 1]] = value;

            // Immediately update agentConfig state and trigger debounced backend update
            setAgentConfig((prevConfig: any) => {
                const newConfig = {
                    ...prevConfig,
                    teaching_persona: newPersona
                };
                debouncedUpdateConfig(newConfig); // Trigger debounced save
                return newConfig; // Update local state immediately
            });
            return newPersona; // Update teachingPersona state
        });
    };

    // Update recurring phrases helper
    const updateRecurringPhrases = (text: string) => {
        const phrases = text
            .split('\n')
            .filter(line => line.trim() !== '')
            .map(phrase => ({
                phrase: phrase.trim(),
                frequency: "medium",
                usage_context: "General conversation"
            }));
        updateTeachingPersonaField('communication_patterns.recurring_phrases', phrases);
    };

    // Initialize phrasesText from teachingPersona
    useEffect(() => {
        if (teachingPersona?.communication_patterns?.recurring_phrases) {
            setPhrasesText(teachingPersona.communication_patterns.recurring_phrases
                .map((p: any) => p.phrase)
                .join('\n')
            );
        }
    }, [teachingPersona]);

    // --- Engagement Logic ---
    const updateEngagementOpportunitiesBackend = (opportunities: EngagementOpportunity[]) => {
        setAgentConfig((prevConfig: any) => {
            const newConfig = {
                ...prevConfig,
                engagement_opportunities: opportunities
            };
            updateAgentConfigBackend(newConfig); // Use the general backend update function
            return newConfig;
        });
    };

    const handleUpdateEngagement = (updatedEngagement: EngagementOpportunity) => {
        const updatedOpportunities = engagementOpportunities.map(engagement =>
            engagement.id === updatedEngagement.id ? updatedEngagement : engagement
        );
        setEngagementOpportunities(updatedOpportunities);
        updateEngagementOpportunitiesBackend(updatedOpportunities);
    };

    const handleDeleteEngagement = (id: string) => {
        const updatedOpportunities = engagementOpportunities.filter(engagement => engagement.id !== id);
        setEngagementOpportunities(updatedOpportunities);
        updateEngagementOpportunitiesBackend(updatedOpportunities);
    };

    const handleAddEngagement = () => {
        const newId = `engagement-${Date.now()}`;
        const newEngagement: EngagementOpportunity = {
            id: newId, rationale: "New rationale", timestamp: "00:00:00",
            quiz_items: [{ question: "New Question", question_type: "multiple_choice", options: ["A", "B"], correct_option: "A" }],
            section_id: "section-1", engagement_type: "quiz", concepts_addressed: ["New"]
        };
        const updatedOpportunities = [...engagementOpportunities, newEngagement];
        setEngagementOpportunities(updatedOpportunities);
        updateEngagementOpportunitiesBackend(updatedOpportunities);
    };

    // --- Voice Logic ---
    const handleSelectVoice = async (voiceId: string, fromBrdgeId?: string | number) => {
        if (!params.brdgeId || !params.apiBaseUrl) return;
        const voice_id = voiceId === "default" ? null : voiceId;
        try {
            const headers: HeadersInit = { 'Content-Type': 'application/json' };
            if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
            const updateResponse = await fetch(`${params.apiBaseUrl}/brdges/${params.brdgeId}/update-voice`, {
                method: 'POST', headers, body: JSON.stringify({ voice_id }), credentials: 'omit'
            });
            if (!updateResponse.ok) throw new Error('Failed to update voice selection');

            // Update local state
            setSelectedVoice(voice_id);
            setSelectedVoiceBrdgeId(voiceId === "default" ? null : String(fromBrdgeId));
            fetchBrdge(); // Refresh brdge data
            fetchVoices(); // Refresh voice list
        } catch (error) {
            console.error('Error updating voice selection:', error);
        }
    };
    // TODO: Add voice recording/cloning logic if needed

    // --- Share Logic ---
    const toggleShareable = async () => {
        if (!params.brdgeId || !params.apiBaseUrl || !brdge) return;
        try {
            const headers: HeadersInit = { 'Content-Type': 'application/json' };
            if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
            const response = await fetch(`${params.apiBaseUrl}/brdges/${params.brdgeId}/toggle_shareable`, {
                method: 'POST', headers, credentials: 'omit'
            });
            if (!response.ok) throw new Error('Failed to toggle shareable status');
            const data = await response.json();
            setBrdge(prev => prev ? { ...prev, shareable: data.shareable } : null); // Updates brdge state
            // updateShareableLink will be called automatically by the useEffect watching brdge
        } catch (error) {
            console.error('Error toggling shareable status:', error);
        }
    };

    const copyLinkToClipboard = () => {
        if (!shareableLink) return;
        navigator.clipboard.writeText(shareableLink).then(() => {
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        }).catch(err => console.error('Failed to copy link:', err));
    };

    // --- Engagement Card Component (Inline for now) ---
    const EngagementCard: React.FC<{ engagement: EngagementOpportunity; onEdit: Function; onDelete: Function }> = ({ engagement, onEdit, onDelete }) => {
        const [isExpanded, setIsExpanded] = useState(false);
        // Simplified: Just display info, no inline editing for now
        return (
            <div className="border border-[#9C7C38]/30 rounded-lg overflow-hidden bg-[#F5EFE0]/80 mb-3">
                <div
                    className="px-4 py-3 flex items-center justify-between cursor-pointer"
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    <div className="flex items-center gap-2">
                        {getEngagementTypeIcon(engagement.engagement_type)}
                        <span className="text-[14px] font-medium text-[#0A1933]">
                            {engagement.engagement_type === 'quiz' ? 'Quiz' : 'Discussion'} @ {formatVideoTime(engagement.timestamp)}
                        </span>
                    </div>
                    <div className="flex items-center gap-1">
                        {/* <button onClick={(e) => { e.stopPropagation(); /* TODO: Add edit logic * / }} className="p-1.5 rounded-md text-[#1E2A42]"><Edit2 size={16} /></button> */}
                        <button onClick={(e) => { e.stopPropagation(); if (confirm('Delete?')) { onDelete(engagement.id); } }} className="p-1.5 rounded-md text-[#1E2A42]"><Trash2 size={16} /></button>
                        <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.2 }} className="ml-1">
                            <ChevronRight size={16} className="text-[#1E2A42]" />
                        </motion.div>
                    </div>
                </div>
                {isExpanded && (
                    <div className="px-4 pb-3 space-y-2 border-t border-[#9C7C38]/20 pt-2">
                        <div className="text-[11px] text-[#0A1933]/70">Rationale:</div>
                        <div className="text-[12px] text-[#0A1933]">{engagement.rationale}</div>
                        <div className="text-[11px] text-[#0A1933]/70 mt-1">Concepts:</div>
                        <div className="text-[12px] text-[#0A1933]">{engagement.concepts_addressed.join(', ')}</div>
                        {engagement.quiz_items.map((item, idx) => (
                            <div key={idx} className="mt-2 pt-2 border-t border-dashed border-[#9C7C38]/20">
                                <div className="text-[11px] text-[#0A1933]/70">Question {idx + 1} ({item.question_type}):</div>
                                <div className="text-[12px] text-[#0A1933]">{item.question}</div>
                                {item.options && (
                                    <ul className="list-disc pl-5 mt-1 space-y-0.5">
                                        {item.options.map((opt, i) => <li key={i} className={`text-[12px] ${opt === item.correct_option ? 'text-green-700 font-medium' : 'text-[#0A1933]'}`}>{opt}</li>)}
                                    </ul>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    // --- Voice Selector Component (Inline for now) ---
    const VoiceSelector: React.FC<{ voices: EnhancedVoice[], selectedVoice: string | null, onSelect: Function }> = ({ voices, selectedVoice, onSelect }) => {
        return (
            <div className="relative">
                <label className="block text-[#0A1933]/70 text-[12px] font-medium mb-1">Active Voice</label>
                <select
                    value={selectedVoice || 'default'}
                    onChange={(e) => onSelect(e.target.value)}
                    className={`
                        w-full px-3 py-2.5 rounded-lg
                        font-satoshi text-base text-[#0A1933]
                        bg-[#FAF7ED]/80 backdrop-blur-sm
                        border border-[#9C7C38]/30
                        appearance-none
                        transition-all duration-300
                        focus:ring-1 focus:ring-[#9C7C38]/40
                        focus:border-[#9C7C38]/50
                        hover:border-[#9C7C38]/40
                    `}
                >
                    <option value="default">✓ Default AI Voice</option>
                    {voices.map((voice) => (
                        <option key={voice.id} value={voice.id}>
                            {selectedVoice === voice.id ? '✓ ' : ''}{voice.name}
                        </option>
                    ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[#9C7C38]/50 mt-2.5">
                    <ChevronRight size={16} />
                </div>
            </div>
        );
    };

    return (
        <div className="h-screen flex flex-col bg-[#F5EFE0] relative overflow-hidden">
            {/* Initial Loading Overlay */}
            {isInitializing && (
                <div className="absolute inset-0 bg-[#F5EFE0]/80 backdrop-blur-sm flex flex-col items-center justify-center z-50">
                    <Loader2 className="animate-spin text-[#9C7C38] mb-4" size={32} />
                    <p className="text-[#1E2A42] text-sm font-medium">Loading Brdge...</p>
                </div>
            )}

            {/* Video Section with aspect ratio container */}
            <div className="w-full pb-[56.25%] relative bg-black flex-shrink-0">
                <div className="absolute inset-0">
                    <MobileVideoPlayer
                        videoRef={videoRef}
                        videoUrl={videoUrl}
                        currentTime={currentTime}
                        setCurrentTime={setCurrentTime}
                        setDuration={setDuration}
                        onTimeUpdate={() => {
                            if (videoRef.current) {
                                setCurrentTime(videoRef.current.currentTime);
                            }
                        }}
                        isPlaying={isPlaying}
                        setIsPlaying={setIsPlaying}
                        onVideoReady={setIsVideoReadyForListeners}
                    />
                </div>
            </div>

            {/* Progress Bar Section - Replace with MobileProgressBar */}
            <div className="bg-black/40 relative">
                <MobileProgressBar
                    currentTime={currentTime}
                    duration={duration}
                    videoRef={videoRef}
                    setCurrentTime={setCurrentTime}
                    setIsPlaying={setIsPlaying}
                    isPlaying={isPlaying}
                    engagementOpportunities={engagementOpportunities}
                    onMarkerClick={seekToTime}
                />
            </div>

            {/* Content Section */}
            <div className="flex-1 overflow-hidden relative">
                {/* Show chat interface or other tabs based on active tab */}
                <div className={`absolute inset-0 transition-opacity duration-300 ${activeMobileTab === 'chat' ? 'opacity-100 z-30' : 'opacity-0 z-0 pointer-events-none'
                    }`}>
                    {/* Messages container with transcription or regular messages */}
                    <div className="h-full flex flex-col">
                        <div className={`flex-1 overflow-y-auto ${voiceAssistant?.audioTrack ? 'pb-4' : 'pb-[72px]'}`}>
                            {/* Voice Assistant Transcription */}
                            {voiceAssistant?.audioTrack ? (
                                <div className="p-3">
                                    {/* Using TranscriptionTile for advanced transcription visualization, 
                                        but hiding its input by setting className to override layout */}
                                    <div className="transcription-container" style={{ position: 'relative', height: '100%', overflow: 'hidden' }}>
                                        <TranscriptionTile
                                            agentAudioTrack={voiceAssistant.audioTrack}
                                            accentColor={themeColors[0] || "amber"}
                                        />
                                        {/* Hide the ChatTile's input by overlaying a div */}
                                        <div style={{
                                            position: 'absolute',
                                            bottom: 0,
                                            left: 0,
                                            right: 0,
                                            height: '60px',
                                            background: '#F5EFE0',
                                            zIndex: 10
                                        }}></div>
                                    </div>
                                </div>
                            ) : (
                                /* Regular Chat Messages */
                                <div className="px-4 py-3 space-y-3">
                                    <AnimatePresence>
                                        {transcripts.map((message) => (
                                            <motion.div
                                                key={message.timestamp}
                                                initial={{ opacity: 0, y: 5 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: -5 }}
                                                className={`
                                                    ${message.isSelf ? 'ml-auto bg-[#FAF7ED]/80 border border-[#9C7C38]/15' : 'mr-auto bg-[#F5EFE0]/80 border border-[#9C7C38]/25'} 
                                                    rounded-lg p-3
                                                    max-w-[85%] w-auto
                                                    shadow-sm
                                                    transition-all duration-300
                                                    ${message.isError ? 'bg-red-50 border-red-200' : message.isSelf ? 'hover:border-[#9C7C38]/40' : 'hover:border-[#9C7C38]/40'}
                                                    flex flex-col gap-1
                                                `}
                                            >
                                                <span className="text-[11px] text-[#9C7C38]/90 font-medium">
                                                    {message.name}
                                                </span>
                                                <span className={`
                                                    text-[13px] leading-relaxed break-words 
                                                    ${message.isError
                                                        ? 'text-red-700 font-satoshi'
                                                        : message.isSelf
                                                            ? 'text-[#0A1933] font-satoshi'
                                                            : 'text-[#1E2A42] font-serif'}
                                                `}>
                                                    {message.message}
                                                </span>
                                            </motion.div>
                                        ))}
                                    </AnimatePresence>
                                </div>
                            )}
                            <div ref={messagesEndRef} style={{ height: 0 }} /> {/* Invisible element for scrolling */}
                        </div>

                        {/* Single Fixed Chat Input - Always visible regardless of mode */}
                        <div className="fixed bottom-0 left-0 right-0 z-40 px-3 py-3 
                            bg-[#F5EFE0]/95 backdrop-blur-sm border-t border-[#9C7C38]/30
                            after:absolute after:inset-0 after:bg-[url('/textures/parchment.png')] 
                            after:bg-cover after:opacity-40 after:mix-blend-overlay after:pointer-events-none"
                            style={{
                                paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))',
                                marginBottom: params.agentType === 'edit' ? '3.5rem' : '0'
                            }}
                        >
                            <div className="relative z-10 flex items-end gap-2">
                                {/* Stop Button */}
                                <button
                                    onClick={handleInterruptAgent}
                                    className={`
                                        p-3 rounded-md
                                        ${interruptPressed
                                            ? 'bg-[#9C7C38]/30 text-[#9C7C38] shadow-[0_0_8px_rgba(156,124,56,0.3)]'
                                            : 'bg-[#9C7C38]/15 hover:bg-[#9C7C38]/25 text-[#1E2A42]'}
                                        ${animateInterrupt ? 'scale-105' : 'scale-100'}
                                        transition-all duration-200
                                        flex-shrink-0
                                        min-w-[44px] min-h-[44px]
                                        border ${interruptPressed ? 'border-[#9C7C38]/20' : 'border-[#9C7C38]/0'}
                                    `}
                                    aria-label="Interrupt agent"
                                >
                                    <Square size={16} className={`fill-current ${animateInterrupt ? 'animate-pulse' : ''}`} />
                                </button>

                                {/* Textarea input with starting height */}
                                <textarea
                                    value={messageText}
                                    onChange={(e) => {
                                        setMessageText(e.target.value);
                                        // Auto-resize textarea
                                        e.target.style.height = '44px'; // Always reset to base height first
                                        e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleChatMessage(messageText);
                                            setMessageText('');
                                            // Reset textarea height
                                            if (e.target instanceof HTMLTextAreaElement) {
                                                e.target.style.height = '44px';
                                            }
                                        }
                                    }}
                                    placeholder="Write a message..."
                                    className="
                                        flex-1 py-3 px-4
                                        min-h-[44px] max-h-[120px] h-[44px]
                                        bg-[#FAF7ED]/90 
                                        text-base text-[#0A1933]
                                        placeholder:text-[#1E2A42]/40
                                        rounded-lg resize-none
                                        border border-[#9C7C38]/30
                                        focus:outline-none focus:border-[#9C7C38]/50 focus:ring-1 focus:ring-[#9C7C38]/20
                                        hover:border-[#9C7C38]/40
                                        transition-all duration-300
                                        scrollbar-thin scrollbar-track-transparent
                                        scrollbar-thumb-[#9C7C38]/20
                                        hover:scrollbar-thumb-[#9C7C38]/30
                                        font-satoshi
                                    "
                                    style={{ height: '44px' }}
                                />

                                {/* Mic toggle button */}
                                <button
                                    onClick={() => {
                                        if (roomState === ConnectionState.Connected && localParticipant) {
                                            localParticipant.setMicrophoneEnabled(!localParticipant.isMicrophoneEnabled);
                                        }
                                    }}
                                    disabled={roomState !== ConnectionState.Connected}
                                    className={`
                                        p-3 rounded-md
                                        ${localParticipant?.isMicrophoneEnabled
                                            ? 'bg-[#9C7C38]/30 text-[#9C7C38]'
                                            : 'bg-[#9C7C38]/15 text-[#1E2A42]/70 hover:text-[#9C7C38]'}
                                        transition-all duration-200
                                        hover:bg-[#9C7C38]/20
                                        flex-shrink-0
                                        min-w-[44px] min-h-[44px]
                                    `}
                                >
                                    {localParticipant?.isMicrophoneEnabled ? <Mic size={20} /> : <MicOff size={20} />}
                                </button>

                                {/* Send button (quill style) */}
                                <motion.button
                                    whileTap={{ scale: 0.95 }}
                                    onClick={() => {
                                        handleChatMessage(messageText);
                                        setMessageText('');
                                        // Reset textarea height
                                        if (document.activeElement instanceof HTMLTextAreaElement) {
                                            document.activeElement.style.height = '44px';
                                        }
                                    }}
                                    disabled={!messageText.trim()}
                                    className={`
                                        p-3 rounded-md
                                        ${messageText.trim()
                                            ? 'bg-[#9C7C38]/20 text-[#9C7C38] hover:bg-[#9C7C38]/30'
                                            : 'bg-[#9C7C38]/10 text-[#1E2A42]/30'}
                                        transition-all duration-200
                                        flex-shrink-0
                                        min-w-[44px] min-h-[44px]
                                    `}
                                >
                                    <Send size={20} />
                                </motion.button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Other tab content will be added in future phases */}
                {params.agentType === 'edit' && (
                    <>
                        {/* Engagement Tab Content */}
                        <div className={`absolute inset-0 transition-opacity duration-300 overflow-y-auto p-4 ${activeMobileTab === 'engagement' ? 'opacity-100 z-30' : 'opacity-0 z-0 pointer-events-none'}`}>
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-lg font-semibold text-[#0A1933]">Engagement</h2>
                                <button onClick={handleAddEngagement} className="p-2 rounded-lg bg-[#9C7C38]/20 text-[#9C7C38] flex items-center gap-1.5 text-sm">
                                    <Plus size={16} /> Add New
                                </button>
                            </div>
                            {/* Filter buttons */}
                            <div className="flex items-center gap-2 mb-4 pb-2 overflow-x-auto scrollbar-none">
                                <button onClick={() => setSelectedEngagementType(null)} className={`px-3 py-1.5 rounded-full min-w-[80px] text-[13px] ${!selectedEngagementType ? 'bg-[#9C7C38]/20 text-[#9C7C38]' : 'bg-[#F5EFE0]/70 text-[#1E2A42]'}`}>All</button>
                                <button onClick={() => setSelectedEngagementType('quiz')} className={`px-3 py-1.5 rounded-full min-w-[80px] text-[13px] flex items-center gap-1.5 ${selectedEngagementType === 'quiz' ? 'bg-[#9C7C38]/20 text-[#9C7C38]' : 'bg-[#F5EFE0]/70 text-[#1E2A42]'}`}>{getEngagementTypeIcon('quiz')}Quizzes</button>
                                <button onClick={() => setSelectedEngagementType('discussion')} className={`px-3 py-1.5 rounded-full min-w-[80px] text-[13px] flex items-center gap-1.5 ${selectedEngagementType === 'discussion' ? 'bg-[#9C7C38]/20 text-[#9C7C38]' : 'bg-[#F5EFE0]/70 text-[#1E2A42]'}`}>{getEngagementTypeIcon('discussion')}Discussions</button>
                            </div>
                            {/* Engagement List */}
                            {engagementOpportunities && engagementOpportunities.length > 0 ? (
                                engagementOpportunities
                                    .filter(e => !selectedEngagementType || e.engagement_type === selectedEngagementType)
                                    .map((engagement) => (
                                        <EngagementCard
                                            key={engagement.id}
                                            engagement={engagement}
                                            onEdit={handleUpdateEngagement}
                                            onDelete={handleDeleteEngagement}
                                        />
                                    ))
                            ) : (
                                <div className="text-center p-6 bg-[#F5EFE0]/60 rounded-lg border border-[#9C7C38]/30 text-sm text-[#1E2A42]/70">
                                    No engagement opportunities yet.
                                </div>
                            )}
                            <div className="h-20"></div> {/* Add padding at the bottom */}
                        </div>

                        {/* Persona Tab Content */}
                        <div className={`absolute inset-0 transition-opacity duration-300 overflow-y-auto p-4 ${activeMobileTab === 'teaching-persona' ? 'opacity-100 z-30' : 'opacity-0 z-0 pointer-events-none'}`}>
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-lg font-semibold text-[#0A1933]">Teaching Persona</h2>
                                <button onClick={() => updateAgentConfigBackend(agentConfig)} disabled={isSaving} className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-sm ${saveSuccess ? 'bg-green-500/10 text-green-600 border-green-500/30' : 'bg-[#9C7C38]/20 text-[#9C7C38] border-[#9C7C38]/30'} border transition-all`}>
                                    <Save size={14} /> {isSaving ? 'Saving...' : (saveSuccess ? 'Saved!' : 'Save')}
                                </button>
                            </div>
                            {teachingPersona ? (
                                <div className="space-y-4">
                                    {/* Instructor Profile */}
                                    <div className="border border-[#9C7C38]/30 rounded-lg p-4 bg-[#F5EFE0]/80">
                                        <h3 className="text-sm font-medium text-[#0A1933] mb-2">Instructor Profile</h3>
                                        <label className="block mb-1 text-[13px] font-medium text-[#0A1933]/70">Name</label>
                                        <input type="text" value={teachingPersona?.instructor_profile?.name || ''} onChange={(e) => updateTeachingPersonaField('instructor_profile.name', e.target.value)} className="w-full bg-[#FAF7ED]/80 border border-[#9C7C38]/30 rounded-lg px-3 py-2 text-base text-[#0A1933] mb-2" placeholder="Instructor Name" />
                                        <div className="text-[11px] text-[#0A1933]/70">Expertise: {teachingPersona?.instructor_profile?.apparent_expertise_level || 'N/A'}</div>
                                    </div>
                                    {/* Communication Style */}
                                    <div className="border border-[#9C7C38]/30 rounded-lg p-4 bg-[#F5EFE0]/80">
                                        <h3 className="text-sm font-medium text-[#0A1933] mb-2">Communication Style</h3>
                                        <label className="block mb-1 text-[13px] font-medium text-[#0A1933]/70">Overall Style</label>
                                        <input type="text" value={teachingPersona?.communication_patterns?.vocabulary_level || ''} onChange={(e) => updateTeachingPersonaField('communication_patterns.vocabulary_level', e.target.value)} className="w-full bg-[#FAF7ED]/80 border border-[#9C7C38]/30 rounded-lg px-3 py-2 text-base text-[#0A1933] mb-2" placeholder="e.g., friendly, technical" />
                                        <label className="block mb-1 text-[13px] font-medium text-[#0A1933]/70">Characteristic Phrases (one per line)</label>
                                        <textarea value={phrasesText} onChange={(e) => setPhrasesText(e.target.value)} onBlur={() => updateRecurringPhrases(phrasesText)} className="w-full bg-[#FAF7ED]/80 border border-[#9C7C38]/30 rounded-lg px-3 py-2 text-base text-[#0A1933] min-h-[100px]" placeholder="Frequent phrases..." />
                                    </div>
                                    {/* Teaching Insights (Display Only) */}
                                    <div className="border border-[#9C7C38]/30 rounded-lg p-4 bg-[#F5EFE0]/80 opacity-70">
                                        <h3 className="text-sm font-medium text-[#0A1933] mb-2">Teaching Insights (Auto-Extracted)</h3>
                                        <p className="text-[12px] text-[#1E2A42]">Speech Style: {teachingPersona?.speech_characteristics?.accent?.type || 'N/A'} ({teachingPersona?.speech_characteristics?.accent?.cadence || 'N/A'})</p>
                                        {/* Add more display fields if needed */}
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center p-6 bg-[#F5EFE0]/60 rounded-lg border border-[#9C7C38]/30 text-sm text-[#1E2A42]/70">
                                    Loading Persona...
                                </div>
                            )}
                            <div className="h-20"></div> {/* Add padding at the bottom */}
                        </div>

                        {/* Voice Tab Content */}
                        <div className={`absolute inset-0 transition-opacity duration-300 overflow-y-auto p-4 ${activeMobileTab === 'voice-clone' ? 'opacity-100 z-30' : 'opacity-0 z-0 pointer-events-none'}`}>
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-lg font-semibold text-[#0A1933]">Voice</h2>
                                {/* Add Create Voice button later if needed */}
                            </div>
                            <div className="space-y-4">
                                <VoiceSelector voices={savedVoices} selectedVoice={selectedVoice} onSelect={handleSelectVoice} />
                                {/* TODO: Add voice creation UI here when isCreatingVoice is true */}
                            </div>
                            <div className="h-20"></div> {/* Add padding at the bottom */}
                        </div>

                        {/* Share Tab Content */}
                        <div className={`absolute inset-0 transition-opacity duration-300 overflow-y-auto p-4 ${activeMobileTab === 'share' ? 'opacity-100 z-30' : 'opacity-0 z-0 pointer-events-none'}`}>
                            <h2 className="text-lg font-semibold text-[#0A1933] mb-4">Share</h2>
                            <div className="space-y-6">
                                {/* Public Access Toggle */}
                                <div className="border border-[#9C7C38]/30 rounded-lg p-4 bg-[#F5EFE0]/80">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            {brdge?.shareable ? <Globe size={18} className="text-[#9C7C38]" /> : <Lock size={18} className="text-[#1E2A42]" />}
                                            <h3 className="text-[14px] font-medium">{brdge?.shareable ? 'Public' : 'Private'}</h3>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input type="checkbox" checked={brdge?.shareable || false} onChange={toggleShareable} className="sr-only peer" />
                                            <div className={`w-11 h-6 rounded-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full ${brdge?.shareable ? 'bg-[#9C7C38]/30 border-[#9C7C38]/50' : 'bg-[#F5EFE0] border-[#9C7C38]/20'} border`}></div>
                                        </label>
                                    </div>
                                    <p className="text-[12px] text-[#0A1933]/70 mt-1">{brdge?.shareable ? "Anyone with the link can view" : "Only you can view"}</p>
                                </div>
                                {/* Share Link */}
                                <div className={`border rounded-lg p-4 bg-[#F5EFE0]/80 ${brdge?.shareable ? 'border-[#9C7C38]/30' : 'border-[#9C7C38]/20 opacity-50'}`}>
                                    <h3 className="text-sm font-medium text-[#0A1933] mb-2">Share Link</h3>
                                    {brdge?.shareable ? (
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2">
                                                <div className="flex-1 px-3 py-2 bg-[#FAF7ED]/80 border border-[#9C7C38]/30 rounded-lg text-[13px] text-[#0A1933] truncate">{shareableLink}</div>
                                                <button onClick={copyLinkToClipboard} className={`p-2 rounded-lg transition-all ${isCopied ? 'bg-green-500/10 text-green-600' : 'bg-[#9C7C38]/10 text-[#9C7C38] hover:bg-[#9C7C38]/20'}`}>
                                                    {isCopied ? <Check size={18} /> : <Copy size={18} />}
                                                </button>
                                            </div>
                                            <a href={shareableLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-[#9C7C38] hover:underline"><ExternalLink size={12} /> Open Link</a>
                                            {isCopied && <p className="text-[11px] text-green-600">Link copied!</p>}
                                        </div>
                                    ) : (
                                        <p className="text-[13px] text-[#0A1933]/70 text-center py-2">Enable public access to get link</p>
                                    )}
                                </div>
                            </div>
                            <div className="h-20"></div> {/* Add padding at the bottom */}
                        </div>
                    </>
                )}
            </div>

            {/* Bottom Tab Bar (only in edit mode) */}
            {params.agentType === 'edit' && (
                <div className="h-14 bg-[#F5EFE0] border-t border-[#9C7C38]/30 flex-shrink-0">
                    <div className="h-full flex items-center justify-around px-2">
                        <button
                            className={`relative flex flex-col items-center justify-center px-3 py-1 
                                ${activeMobileTab === 'chat' ? 'text-[#9C7C38]' : 'text-[#1E2A42]/60'}`}
                            onClick={() => setActiveMobileTab('chat')}
                        >
                            {activeMobileTab === 'chat' && (
                                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full 
                                    bg-[#9C7C38] shadow-[0_0_5px_rgba(156,124,56,0.5)]" />
                            )}
                            <MessageSquare size={18} className="mb-1" />
                            <div className="text-xs">Chat</div>
                        </button>
                        <button
                            className={`relative flex flex-col items-center justify-center px-3 py-1 
                                ${activeMobileTab === 'engagement' ? 'text-[#9C7C38]' : 'text-[#1E2A42]/60'}`}
                            onClick={() => setActiveMobileTab('engagement')}
                        >
                            {activeMobileTab === 'engagement' && (
                                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full 
                                    bg-[#9C7C38] shadow-[0_0_5px_rgba(156,124,56,0.5)]" />
                            )}
                            <ClipboardList size={18} className="mb-1" />
                            <div className="text-xs">Engage</div>
                        </button>
                        <button
                            className={`relative flex flex-col items-center justify-center px-3 py-1 
                                ${activeMobileTab === 'teaching-persona' ? 'text-[#9C7C38]' : 'text-[#1E2A42]/60'}`}
                            onClick={() => setActiveMobileTab('teaching-persona')}
                        >
                            {activeMobileTab === 'teaching-persona' && (
                                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full 
                                    bg-[#9C7C38] shadow-[0_0_5px_rgba(156,124,56,0.5)]" />
                            )}
                            <User size={18} className="mb-1" />
                            <div className="text-xs">Persona</div>
                        </button>
                        <button
                            className={`relative flex flex-col items-center justify-center px-3 py-1 
                                ${activeMobileTab === 'voice-clone' ? 'text-[#9C7C38]' : 'text-[#1E2A42]/60'}`}
                            onClick={() => setActiveMobileTab('voice-clone')}
                        >
                            {activeMobileTab === 'voice-clone' && (
                                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full 
                                    bg-[#9C7C38] shadow-[0_0_5px_rgba(156,124,56,0.5)]" />
                            )}
                            <Radio size={18} className="mb-1" />
                            <div className="text-xs">Voice</div>
                        </button>
                        <button
                            className={`relative flex flex-col items-center justify-center px-3 py-1 
                                ${activeMobileTab === 'share' ? 'text-[#9C7C38]' : 'text-[#1E2A42]/60'}`}
                            onClick={() => setActiveMobileTab('share')}
                        >
                            {activeMobileTab === 'share' && (
                                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full 
                                    bg-[#9C7C38] shadow-[0_0_5px_rgba(156,124,56,0.5)]" />
                            )}
                            <Share2 size={18} className="mb-1" />
                            <div className="text-xs">Share</div>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}