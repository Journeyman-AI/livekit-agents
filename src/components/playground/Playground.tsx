"use client";

import { LoadingSVG } from "@/components/button/LoadingSVG";
import { ChatMessageType } from "@/components/chat/ChatTile";
import { ColorPicker } from "@/components/colorPicker/ColorPicker";
import { AudioInputTile } from "@/components/config/AudioInputTile";
import { ConfigurationPanelItem } from "@/components/config/ConfigurationPanelItem";
import { NameValueRow } from "@/components/config/NameValueRow";
import { PlaygroundHeader } from "@/components/playground/PlaygroundHeader";
import {
  PlaygroundTab,
  PlaygroundTabbedTile,
  PlaygroundTile,
} from "@/components/playground/PlaygroundTile";
import { useConfig } from "@/hooks/useConfig";
import { TranscriptionTile } from "@/transcriptions/TranscriptionTile";
import {
  BarVisualizer,
  useConnectionState,
  useDataChannel,
  useLocalParticipant,
  useRoomInfo,
  useVoiceAssistant,
  useChat,
} from "@livekit/components-react";
import { ConnectionState, LocalParticipant, Track, DataPacket_Kind } from "livekit-client";
import { QRCodeSVG } from "qrcode.react";
import { ReactNode, useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useSearchParams } from 'next/navigation';
import tailwindTheme from "../../lib/tailwindTheme.preval";
import { InfoPanel } from "./InfoPanel";
import { API_BASE_URL } from '@/config';
import { api } from '@/api';
import { SlideScriptPanel } from './SlideScriptPanel';
import { ViewerHeader } from './ViewerHeader';
import { jwtDecode } from "jwt-decode";
import Image from 'next/image';
import { ChatMessageInput } from "@/components/chat/ChatMessageInput";
import styles from '@/styles/animations.module.css';
import {
  Panel,
  PanelGroup,
  PanelResizeHandle
} from 'react-resizable-panels';
import { useRouter } from 'next/router';
import { MobileConfigDrawer } from './MobileConfigDrawer';
import { WalkthroughSelector, WalkthroughSelectorRef } from './WalkthroughSelector';

export interface PlaygroundProps {
  logo?: ReactNode;
  themeColors: string[];
  onConnect: (connect: boolean, opts?: { token: string; url: string }) => void;
  onScriptsGenerated?: (scripts: Record<string, any>) => void;
}

const headerHeight = 56;

interface BrdgeMetadata {
  id: string;
  name: string;
  numSlides: number;
}

interface SlideScripts {
  [key: string]: string;
}

interface ScriptData {
  slide_scripts: SlideScripts;
  generated_at: string;
  source_walkthrough_id: string;
}

type AgentType = 'edit' | 'view';

interface JWTPayload {
  sub: string;
  exp: number;
  iat: number;
}

const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkIsMobile = () => {
      setIsMobile(window.innerWidth < 640);
    };

    checkIsMobile();
    window.addEventListener('resize', checkIsMobile);
    return () => window.removeEventListener('resize', checkIsMobile);
  }, []);

  return isMobile;
};

type MobileTab = 'chat' | 'script' | 'voice' | 'info';

const componentStyles = {
  button: `
    relative overflow-hidden
    px-6 py-3 rounded-xl font-medium
    transition-all duration-300 ease-out
    hover:scale-[1.02] active:scale-[0.98]
    disabled:opacity-50 disabled:cursor-not-allowed
    bg-gradient-to-r from-cyan-500 to-cyan-600
    hover:from-cyan-400 hover:to-cyan-500
    text-white shadow-lg shadow-cyan-500/20
    hover:shadow-xl hover:shadow-cyan-500/30
    disabled:hover:scale-100 disabled:hover:shadow-lg
    transform hover:-translate-y-0.5
  `,
  tabButton: `
    flex-1 px-4 py-3 text-sm font-medium
    transition-all duration-300 ease-out
    hover:bg-gray-800/50
    border border-transparent
    hover:border-cyan-500/30
    hover:shadow-[0_0_15px_rgba(0,255,255,0.1)]
  `,
  activeTab: `
    bg-gradient-to-r from-cyan-500/20 to-cyan-400/20
    border-b-2 border-cyan-500
    text-cyan-400
    shadow-[0_0_10px_rgba(0,255,255,0.2)]
  `,
  chatBubble: `
    max-w-[70%] rounded-2xl p-3
    backdrop-blur-sm shadow-lg
    animate-[fadeIn_0.3s_ease-out]
    bg-gray-900/50
    border border-gray-800/50
    hover:border-cyan-500/20
    transition-all duration-300
  `,
  input: `
    w-full bg-gray-900/50 backdrop-blur-sm
    border border-gray-700 rounded-xl
    px-4 py-3 text-gray-300
    transition-all duration-300
    focus:ring-2 focus:ring-cyan-500 focus:border-transparent
    hover:border-cyan-500/50
    hover:shadow-[0_0_15px_rgba(0,255,255,0.1)]
  `,
  scrollArea: `
    scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent
    hover:scrollbar-thumb-gray-600
    scroll-smooth
  `
};

const resizeHandleStyles = {
  vertical: `
    w-1.5 mx-1 my-2 rounded-full
    bg-gray-800 hover:bg-gray-700
    transition-colors duration-150
    cursor-col-resize
    flex items-center justify-center
    group
  `,
  horizontal: `
    h-1.5 my-1 mx-2 rounded-full
    bg-gray-800 hover:bg-gray-700
    transition-colors duration-150
    cursor-row-resize
    flex items-center justify-center
    group
  `
};

// Update the DataChannelMessage interface to match LiveKit's ReceivedDataMessage type
interface DataChannelMessage {
  payload: Uint8Array;
  topic?: string;
  kind?: DataPacket_Kind;
}

// Add this interface near the top with other interfaces
interface ScriptContent {
  script: string;
  agent: string;
}

export default function Playground({
  logo,
  themeColors,
  onConnect,
  onScriptsGenerated
}: PlaygroundProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [configTab, setConfigTab] = useState<'agent' | 'voice' | 'workflow'>('agent');
  const isMobile = useIsMobile();

  const [params, setParams] = useState({
    brdgeId: null as string | null,
    numSlides: 0,
    apiBaseUrl: null as string | null,
    coreApiUrl: API_BASE_URL,
    currentSlide: 1,
    userId: null as string | null
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const token = urlParams.get('token');
      const newParams = {
        brdgeId: urlParams.get('brdgeId'),
        numSlides: parseInt(urlParams.get('numSlides') || '0'),
        apiBaseUrl: urlParams.get('apiBaseUrl'),
        coreApiUrl: API_BASE_URL,
        currentSlide: 1,
        userId: token ?
          jwtDecode<JWTPayload>(token).sub :
          `anon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };

      setParams(newParams);
    }
  }, []);

  const { config, setUserSettings } = useConfig();
  const { name } = useRoomInfo();
  const { localParticipant } = useLocalParticipant();
  const voiceAssistant = useVoiceAssistant();
  const roomState = useConnectionState();
  const [transcripts, setTranscripts] = useState<ChatMessageType[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSentSlide = useRef<number | null>(null);
  const [brdgeMetadata, setBrdgeMetadata] = useState<BrdgeMetadata | null>(null);
  const [showInfo, setShowInfo] = useState(true);
  const [currentAgentType, setCurrentAgentType] = useState<AgentType>('edit');
  const [selectedWalkthrough, setSelectedWalkthrough] = useState<number | null>(null);
  const [scripts, setScripts] = useState<Record<string, ScriptContent> | null>(null);
  const [isGeneratingScripts, setIsGeneratingScripts] = useState(false);
  const [editedScripts, setEditedScripts] = useState<Record<string, ScriptContent>>({});
  const [hasScriptChanges, setHasScriptChanges] = useState(false);
  const [walkthroughs, setWalkthroughs] = useState<any[]>([]);
  const [rightPanelView, setRightPanelView] = useState<'chat' | 'info'>('info');
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [forceUpdate, setForceUpdate] = useState(0);
  const [forceRefresh, setForceRefresh] = useState(Date.now());
  const [isConfigDrawerOpen, setIsConfigDrawerOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat');
  const [forceWalkthroughRefresh, setForceWalkthroughRefresh] = useState(0);
  const walkthroughSelectorRef = useRef<WalkthroughSelectorRef>(null);

  useEffect(() => {
    if (roomState === ConnectionState.Connected) {
      setShowInfo(false);
    } else {
      setShowInfo(true);
    }
  }, [roomState]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const agentType = urlParams.get('agentType') as AgentType;
      if (agentType && (agentType === 'edit' || agentType === 'view')) {
        setCurrentAgentType(agentType);
      }
    }
  }, []);

  const loadWalkthroughs = useCallback(async () => {
    if (!params.brdgeId) return;
    try {
      const response = await api.get(`/brdges/${params.brdgeId}/walkthrough-list`);
      if (response.data.has_walkthroughs) {
        const sortedWalkthroughs = response.data.walkthroughs.sort(
          (a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        setWalkthroughs(sortedWalkthroughs);

        if (!selectedWalkthrough && sortedWalkthroughs.length > 0) {
          const latestWalkthrough = sortedWalkthroughs[0];
          setSelectedWalkthrough(latestWalkthrough.id);
        }

        setConfigTab(prev => prev === 'workflow' ? 'workflow' : 'workflow');
      }
    } catch (error) {
      console.error('Error loading walkthroughs:', error);
    }
  }, [params.brdgeId, selectedWalkthrough]);

  const chat = useChat();

  const handleChatMessage = useCallback(async (message: string) => {
    if (!chat) return;

    try {
      await chat.send(message);
      setTranscripts(prev => [...prev, {
        name: "You",
        message: message,
        timestamp: Date.now(),
        isSelf: true,
      }]);
    } catch (error) {
      console.error('Error sending chat message:', error);
    }
  }, [chat]);

  const { send } = useDataChannel("slide_updates", (message: DataChannelMessage) => {
    try {
      const decoded = JSON.parse(new TextDecoder().decode(message.payload));
      if (decoded.type === "SCRIPTS_UPDATED") {
        loadInitialScripts();
      }
    } catch (error) {
      console.error("Error processing data channel message:", error);
    }
  });

  const onDataReceived = useCallback((msg: any) => {
    try {
      if (msg.topic === "transcription") {
        const decoded = JSON.parse(new TextDecoder().decode(msg.payload));
        const timestamp = decoded.timestamp > 0 ? decoded.timestamp : Date.now();

        setTranscripts(prev => [...prev, {
          name: "You",
          message: decoded.text,
          timestamp: timestamp,
          isSelf: true,
        }]);
      } else if (msg.topic === "chat") {
        const decoded = JSON.parse(new TextDecoder().decode(msg.payload));
        setTranscripts(prev => [...prev, {
          name: "Assistant",
          message: decoded.text,
          timestamp: Date.now(),
          isSelf: false,
        }]);
      } else if (msg.topic === "walkthrough_completed") {
        console.log("Walkthrough completed, refreshing...");
        // Immediate refresh
        setForceWalkthroughRefresh(prev => prev + 1);
        walkthroughSelectorRef.current?.refreshWalkthroughs();

        // Start polling with shorter intervals initially
        let attempts = 0;
        const maxAttempts = 10;
        const pollInterval = 500; // 500ms

        const pollForNewWalkthrough = async () => {
          try {
            console.log("Polling for new walkthrough...");
            const response = await api.get(`/brdges/${params.brdgeId}/walkthrough-list`);
            if (response.data.has_walkthroughs) {
              const sortedWalkthroughs = response.data.walkthroughs.sort(
                (a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
              );

              // Check if we have a new walkthrough
              if (sortedWalkthroughs.length > walkthroughs.length) {
                console.log("New walkthrough found, updating state...");
                setWalkthroughs(sortedWalkthroughs);
                setSelectedWalkthrough(sortedWalkthroughs[0].id);
                setConfigTab('workflow');
                return true;
              }
            }
            return false;
          } catch (error) {
            console.error('Error polling walkthroughs:', error);
            return false;
          }
        };

        const poll = async () => {
          while (attempts < maxAttempts) {
            console.log(`Polling attempt ${attempts + 1}/${maxAttempts}`);
            const found = await pollForNewWalkthrough();
            if (found) {
              console.log("Successfully found and updated new walkthrough");
              break;
            }

            attempts++;
            if (attempts < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, pollInterval));
            }
          }
        };

        poll();
      }
    } catch (error) {
      console.error("Error processing message:", error);
    }
  }, [params.brdgeId, walkthroughs.length]);

  useDataChannel(onDataReceived);

  useEffect(() => {
    loadWalkthroughs();
  }, [loadWalkthroughs, forceUpdate]);

  const handleWalkthroughClick = useCallback(async (agentType: AgentType = 'edit') => {
    try {
      setIsConnecting(true);
      setCurrentAgentType(agentType);

      if (roomState === ConnectionState.Connected) {
        // First stop the connection
        await onConnect(false);

        // Force immediate refresh of walkthroughs
        console.log("Forcing walkthrough refresh...");
        setForceWalkthroughRefresh(prev => prev + 1);
        await walkthroughSelectorRef.current?.refreshWalkthroughs();

        // Wait a bit for the backend
        await new Promise(resolve => setTimeout(resolve, 500));

        // Try to force a complete refresh by navigating to the same URL
        const currentUrl = window.location.href;
        window.location.href = currentUrl;

      } else {
        await onConnect(true);
        if (agentType === 'edit') {
          setCurrentStep(1);
        }
      }
    } catch (error) {
      console.error('Error in handleWalkthroughClick:', error);
    } finally {
      setIsConnecting(false);
    }
  }, [roomState, onConnect]);

  const handleStartWalkthrough = useCallback(() => {
    setCurrentStep(1);
    handleWalkthroughClick('edit');
  }, [handleWalkthroughClick]);

  const handleGenerateScripts = useCallback(async () => {
    if (!selectedWalkthrough) return;

    setCurrentStep(2);
    setIsGeneratingScripts(true);

    try {
      const response = await api.post(`/brdges/${params.brdgeId}/generate-slide-scripts`, {
        walkthrough_id: selectedWalkthrough
      });

      if (response.data.scripts) {
        setScripts(response.data.scripts);
        if (onScriptsGenerated) {
          onScriptsGenerated(response.data.scripts);
        }
        setCurrentStep(3);
      }
    } catch (error) {
      console.error('Error generating scripts:', error);
    } finally {
      setIsGeneratingScripts(false);
    }
  }, [selectedWalkthrough, params.brdgeId, onScriptsGenerated]);

  const handleShareBrdge = useCallback(() => {
    setCurrentStep(4);
    // Implement sharing functionality
  }, []);

  const handleScriptsGenerated = useCallback((newScripts: Record<string, any>) => {
    setScripts(newScripts);
    if (onScriptsGenerated) {
      onScriptsGenerated(newScripts);
    }

    if (send && roomState === ConnectionState.Connected) {
      try {
        const message = {
          type: "SCRIPTS_UPDATED",
          brdgeId: params.brdgeId,
          timestamp: Date.now()
        };
        send(new TextEncoder().encode(JSON.stringify(message)), { reliable: true });
      } catch (error) {
        console.error('Error sending script update:', error);
      }
    }
  }, [send, roomState, params.brdgeId, onScriptsGenerated]);

  const loadInitialScripts = useCallback(async () => {
    if (!params.brdgeId) return;

    try {
      const response = await api.get(`/brdges/${params.brdgeId}/scripts`);
      if (response.data.has_scripts) {
        setScripts(response.data.scripts);
      }
    } catch (error) {
      console.error('Error loading initial scripts:', error);
    }
  }, [params.brdgeId]);

  useEffect(() => {
    loadInitialScripts();
  }, [loadInitialScripts]);

  const handleWalkthroughSelect = useCallback((walkthroughId: number) => {
    setSelectedWalkthrough(walkthroughId);
  }, []);

  const sendSlideUpdate = useCallback(() => {
    if (!params.brdgeId || roomState !== ConnectionState.Connected) {
      return;
    }

    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
    }

    if (lastSentSlide.current !== params.currentSlide) {
      updateTimeoutRef.current = setTimeout(() => {
        try {
          if (roomState === ConnectionState.Connected) {
            const slideUrl = `${params.apiBaseUrl}/brdges/${params.brdgeId}/slides/${params.currentSlide}`;
            const message = {
              type: "SLIDE_UPDATE",
              brdgeId: params.brdgeId,
              numSlides: params.numSlides,
              apiBaseUrl: params.apiBaseUrl,
              currentSlide: params.currentSlide,
              slideUrl: slideUrl,
              agentType: currentAgentType,
              userId: params.userId
            };

            const encoder = new TextEncoder();
            const data = encoder.encode(JSON.stringify(message));
            send(data, { reliable: true });
            lastSentSlide.current = params.currentSlide;
          }
        } catch (e) {
          console.error("Error sending slide update:", e);
        }
      }, 300);
    }
  }, [params, roomState, send, currentAgentType]);

  useEffect(() => {
    if (roomState === ConnectionState.Connected && params.brdgeId) {
      lastSentSlide.current = null;
      sendSlideUpdate();
    }
  }, [roomState, params.brdgeId, sendSlideUpdate]);

  useEffect(() => {
    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
      lastSentSlide.current = null;
    };
  }, [roomState]);

  const handlePrevSlide = () => {
    if (params.currentSlide > 1) {
      setParams(prev => ({ ...prev, currentSlide: prev.currentSlide - 1 }));
    }
  };

  const handleNextSlide = () => {
    if (params.currentSlide < params.numSlides) {
      setParams(prev => ({ ...prev, currentSlide: prev.currentSlide + 1 }));
    }
  };

  const hasRequiredParams = useMemo(() => {
    const valid = Boolean(params.brdgeId && params.numSlides > 0 && params.apiBaseUrl);
    if (!valid) {
      console.error('Missing required parameters:', params);
    }
    return valid;
  }, [params]);

  const handleScriptChange = useCallback((slideId: string, newScript: string) => {
    setEditedScripts((prevScripts) => ({
      ...prevScripts,
      [slideId]: {
        script: newScript,
        agent: (prevScripts[slideId]?.agent || '')
      }
    }));
    setHasScriptChanges(true);
  }, []);

  const updateScripts = useCallback((newScripts: Record<string, ScriptContent>) => {
    setScripts(newScripts);
    setEditedScripts({});
    setHasScriptChanges(false);
  }, []);

  const saveScriptChanges = async () => {
    try {
      await api.put(`/brdges/${params.brdgeId}/scripts/update`, {
        scripts: editedScripts,
      });
      setScripts(editedScripts);
      setHasScriptChanges(false);
    } catch (error) {
      console.error('Error updating scripts:', error);
    }
  };

  const slideTileContent = useMemo(() => {
    if (!hasRequiredParams) {
      return (
        <div className="flex items-center justify-center text-gray-700 text-center w-full h-full">
          <div className="flex flex-col items-center gap-4">
            <div>Missing required parameters to display slides</div>
            <div className="text-sm text-gray-500">
              brdgeId: {params.brdgeId || 'missing'}<br />
              numSlides: {params.numSlides || 'missing'}<br />
              apiBaseUrl: {params.apiBaseUrl || 'missing'}
            </div>
          </div>
        </div>
      );
    }

    if (roomState === ConnectionState.Disconnected) {
      return (
        <div className="flex items-center justify-center text-gray-700 text-center w-full h-full">
          Connect to start the session
        </div>
      );
    }

    const slideUrl = `${params.apiBaseUrl}/brdges/${params.brdgeId}/slides/${params.currentSlide}`;

    return (
      <div className="flex flex-col w-full h-full">
        <div className="flex-1 relative bg-gray-900 flex items-center justify-center">
          <Image
            key={slideUrl}
            src={slideUrl}
            alt={`Slide ${params.currentSlide}`}
            className="max-w-full max-h-full object-contain"
            priority={true}
            width={1920}
            height={1080}
            onError={(e) => {
              console.error('Error loading slide image:', slideUrl);
              const target = e.target as HTMLImageElement;
              target.onerror = null;
              target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50%" y="50%" text-anchor="middle" fill="gray">Error loading slide</text></svg>';
            }}
          />
        </div>
        <div className="p-4 bg-gray-900 border-t border-gray-800">
          <div className="flex justify-between items-center">
            <span className="text-gray-400 text-sm">
              Slide {params.currentSlide} of {params.numSlides}
            </span>
            <div className="flex gap-3">
              {scripts && (
                <button
                  onClick={() => {
                    if (roomState === ConnectionState.Connected) {
                      onConnect(false);
                      setRightPanelView('info');
                    } else {
                      handleWalkthroughClick('view');
                    }
                  }}
                  className={`px-4 py-2 ${roomState === ConnectionState.Connected
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-green-600 hover:bg-green-700'
                    } text-white rounded-md transition-colors flex items-center gap-2`}
                >
                  {roomState === ConnectionState.Connected ? (
                    <>
                      <svg
                        className="w-4 h-4"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M6 6h12v12H6z" />
                      </svg>
                      Stop
                    </>
                  ) : (
                    <>
                      <svg
                        className="w-4 h-4"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      Play
                    </>
                  )}
                </button>
              )}

              <button
                onClick={handlePrevSlide}
                disabled={params.currentSlide === 1}
                className="px-4 py-2 bg-gray-800 text-white rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <button
                onClick={handleNextSlide}
                disabled={params.currentSlide === params.numSlides}
                className="px-4 py-2 bg-gray-800 text-white rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        </div>
        {/* No additional chat/transcription here; it's moved to the bottom panel only */}
      </div>
    );
  }, [params, roomState, hasRequiredParams, scripts, handlePrevSlide, handleNextSlide, onConnect, handleWalkthroughClick]);

  useEffect(() => {
    document.body.style.setProperty(
      "--lk-theme-color",
      // @ts-ignore
      tailwindTheme.colors[config.settings.theme_color]["500"]
    );
    document.body.style.setProperty(
      "--lk-drop-shadow",
      `var(--lk-theme-color) 0px 0px 18px`
    );
  }, [config.settings.theme_color]);

  const audioTileContent = useMemo(() => {
    const disconnectedContent = (
      <div className="flex flex-col items-center justify-center gap-2 text-gray-700 text-center w-full">
        No audio track. Connect to get started.
      </div>
    );

    const waitingContent = (
      <div className="flex flex-col items-center gap-2 text-gray-700 text-center w-full">
        <LoadingSVG />
        Waiting for audio track
      </div>
    );

    const visualizerContent = (
      <div
        className={`flex items-center justify-center w-full h-48 [--lk-va-bar-width:30px] [--lk-va-bar-gap:20px] [--lk-fg:var(--lk-theme-color)]`}
      >
        <BarVisualizer
          state={voiceAssistant.state}
          trackRef={voiceAssistant.audioTrack}
          barCount={5}
          options={{ minHeight: 20 }}
        />
      </div>
    );

    if (roomState === ConnectionState.Disconnected) {
      return disconnectedContent;
    }

    if (!voiceAssistant.audioTrack) {
      return waitingContent;
    }

    return visualizerContent;
  }, [
    voiceAssistant.audioTrack,
    config.settings.theme_color,
    roomState,
    voiceAssistant.state,
  ]);

  const settingsTileContent = useMemo(() => {
    return (
      <div className="flex flex-col gap-4 h-full w-full items-start overflow-y-auto">
        {config.description && (
          <ConfigurationPanelItem title="Description">
            {config.description}
          </ConfigurationPanelItem>
        )}

        <ConfigurationPanelItem title="Settings">
          {localParticipant && (
            <div className="flex flex-col gap-2">
              <NameValueRow
                name="Room"
                value={name}
                valueColor={`${config.settings.theme_color}-500`}
              />
              <NameValueRow
                name="Participant"
                value={localParticipant.identity}
              />
            </div>
          )}
        </ConfigurationPanelItem>
        <ConfigurationPanelItem title="Status">
          <div className="flex flex-col gap-2">
            <NameValueRow
              name="Room connected"
              value={
                roomState === ConnectionState.Connecting ? (
                  <LoadingSVG diameter={16} strokeWidth={2} />
                ) : (
                  roomState.toUpperCase()
                )
              }
              valueColor={
                roomState === ConnectionState.Connected
                  ? `${config.settings.theme_color}-500`
                  : "gray-500"
              }
            />
            <NameValueRow
              name="Microphone"
              value={localParticipant?.isMicrophoneEnabled ? "ENABLED" : "DISABLED"}
              valueColor={
                localParticipant?.isMicrophoneEnabled
                  ? `${config.settings.theme_color}-500`
                  : "gray-500"
              }
            />
          </div>
        </ConfigurationPanelItem>
        <div className="w-full">
          <ConfigurationPanelItem title="Color">
            <ColorPicker
              colors={themeColors}
              selectedColor={config.settings.theme_color}
              onSelect={(color) => {
                const userSettings = { ...config.settings };
                userSettings.theme_color = color;
                setUserSettings(userSettings);
              }}
            />
          </ConfigurationPanelItem>
        </div>
      </div>
    );
  }, [
    config.description,
    config.settings.theme_color,
    localParticipant,
    name,
    roomState,
    themeColors,
    setUserSettings,
  ]);

  const THEME = {
    primary: 'cyan',
    bgDark: 'gray-900',
    bgLight: 'gray-50',
    text: 'gray-100',
  };

  useEffect(() => {
    if (roomState === ConnectionState.Connected && localParticipant) {
      localParticipant.setMicrophoneEnabled(true);
    }
  }, [roomState, localParticipant]);

  const getSlideUrl = useCallback((): string => {
    if (!params.apiBaseUrl || !params.brdgeId || !params.currentSlide) {
      return '';
    }
    return `${params.apiBaseUrl}/brdges/${params.brdgeId}/slides/${params.currentSlide}`;
  }, [params.apiBaseUrl, params.brdgeId, params.currentSlide]);

  useEffect(() => {
    const fetchBrdgeMetadata = async () => {
      if (!params.brdgeId || !params.apiBaseUrl) return;

      try {
        const response = await fetch(`${params.apiBaseUrl}/brdges/${params.brdgeId}`);
        if (!response.ok) throw new Error('Failed to fetch Brdge metadata');

        const data = await response.json();
        setBrdgeMetadata({
          id: params.brdgeId,
          name: data.name || params.brdgeId,
          numSlides: params.numSlides
        });
      } catch (error) {
        console.error('Error fetching Brdge metadata:', error);
        setBrdgeMetadata({
          id: params.brdgeId!,
          name: params.brdgeId!,
          numSlides: params.numSlides
        });
      }
    };

    fetchBrdgeMetadata();
  }, [params.brdgeId, params.apiBaseUrl, params.numSlides]);

  useEffect(() => {
    const checkExistingScripts = async () => {
      if (!params.brdgeId) return;

      try {
        const response = await api.get(`/brdges/${params.brdgeId}/scripts`);
        if (response.data.has_scripts) {
          setScripts(response.data.scripts);
          setEditedScripts(response.data.scripts);

          const walkthrough_id = parseInt(response.data.metadata.source_walkthrough_id);
          if (walkthrough_id) {
            setSelectedWalkthrough(walkthrough_id);
          }
        }
      } catch (error) {
        console.error('Error checking for existing scripts:', error);
      }
    };

    checkExistingScripts();
  }, [params.brdgeId]);

  const renderRightPanelContent = () => {
    return (
      <div className="flex-1 overflow-hidden">
        <div className={`h-full ${rightPanelView === 'info' ? 'block' : 'hidden'}`}>
          <InfoPanel
            walkthroughCount={walkthroughs.length}
            agentType={currentAgentType}
            brdgeId={params.brdgeId!}
            scripts={scripts}
            isGenerating={isGeneratingScripts}
          />
        </div>
      </div>
    );
  };

  // Add voice-related state
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const [voiceName, setVoiceName] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [currentRecording, setCurrentRecording] = useState<Blob | null>(null);
  const [isCloning, setIsCloning] = useState(false);
  const [savedVoices, setSavedVoices] = useState<Array<{ id: string; name: string; created_at: string }>>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const router = useRouter();

  // Add voice-related handlers
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          setCurrentRecording(new Blob([e.data], { type: 'audio/wav' }));
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Error accessing microphone:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        setRecordingTime(0);
      }

      // Refresh the page by re-navigating to current URL
      router.replace(router.asPath);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleCloneVoice = async () => {
    if (!currentRecording || !voiceName || !params.brdgeId) return;
    setIsCloning(true);
    try {
      const formData = new FormData();
      formData.append('audio', currentRecording);
      formData.append('name', voiceName);

      const response = await api.post(`/brdges/${params.brdgeId}/voice/clone`, formData);

      // Refresh voice list
      const voicesResponse = await api.get(`/brdges/${params.brdgeId}/voices`);
      if (voicesResponse.data?.voices) {
        setSavedVoices(voicesResponse.data.voices);
        if (response.data?.voice?.id) {
          setSelectedVoice(response.data.voice.id);
        }
      }

      // Reset recording state
      setCurrentRecording(null);
      setVoiceName('');
    } catch (error) {
      console.error('Error cloning voice:', error);
    } finally {
      setIsCloning(false);
    }
  };

  // Load saved voices on mount
  useEffect(() => {
    const loadVoices = async () => {
      if (!params.brdgeId) return;
      try {
        const response = await api.get(`/brdges/${params.brdgeId}/voices`);
        if (response.data?.voices) {
          setSavedVoices(response.data.voices);
        }
      } catch (error) {
        console.error('Error loading voices:', error);
      }
    };

    loadVoices();
  }, [params.brdgeId]);

  // Move renderChatMessage inside the component
  const renderChatMessage = useCallback((message: ChatMessageType) => (
    <div
      className={`
        ${message.isSelf ? 'ml-auto bg-cyan-950/30' : 'mr-auto bg-gray-800/30'} 
        max-w-[70%] rounded-2xl p-4 
        backdrop-blur-sm
        border border-gray-700/50
        transition-all duration-300
        hover:border-cyan-500/30
        animate-[fadeIn_0.3s_ease-out]
        shadow-lg hover:shadow-[0_0_20px_rgba(0,255,255,0.1)]
        group
      `}
    >
      <div
        className={`
          text-sm leading-relaxed
          ${message.isSelf
            ? 'text-cyan-300 group-hover:text-cyan-200'
            : 'text-gray-300 group-hover:text-cyan-100'
          }
          ${!message.isSelf && 'animate-[glow_2s_ease-in-out_infinite]'}
          transition-all duration-300
        `}
        style={{
          textShadow: message.isSelf
            ? '0 0 10px rgba(34,211,238,0.3)'
            : '0 0 15px rgba(34,211,238,0.2)'
        }}
      >
        {message.message}
      </div>
    </div>
  ), []);

  return (
    <div key={forceRefresh} className="h-screen flex flex-col bg-[#121212] relative overflow-hidden">
      {/* Minimal Header with glow effect */}
      <div className={`
        flex-shrink-0 
        ${isMobile ? 'h-[36px]' : 'h-[48px]'} 
        border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm 
        flex items-center 
        ${isMobile ? 'px-3' : 'px-6'}
      `}>
        <h1 className={`
          ${isMobile ? 'text-base' : 'text-lg'} 
          font-medium text-cyan-400 transition-all duration-300 
          hover:text-cyan-300 hover:shadow-[0_0_10px_rgba(0,255,255,0.3)]
        `}>
          {brdgeMetadata?.name || params.brdgeId || 'Loading...'}
        </h1>
      </div>

      {/* Main Content Area with Resizable Panels */}
      <div className="flex-1 flex overflow-hidden">
        <PanelGroup direction="horizontal">
          <div className={`
            flex-1 transition-all duration-300
            ${isMobile ? 'w-full' : currentAgentType === 'view' ? 'mr-0' :
              isRightPanelCollapsed ? 'mr-0' : 'mr-[400px]'}
          `}>
            <PanelGroup direction="vertical">
              {/* Slides Area */}
              <Panel
                defaultSize={isMobile ? 85 : isRightPanelCollapsed ? 85 : 70}
                minSize={isMobile ? 70 : 30}
              >
                <div className="h-full w-full overflow-hidden bg-black">
                  <div className="h-full w-full flex items-center justify-center p-0">
                    {getSlideUrl() ? (
                      <div className={`
                        relative w-full h-full flex items-center justify-center 
                        transition-all duration-300 ease-in-out
                        ${isMobile ? 'p-0.5' : 'p-2'}
                      `}>
                        <div className="relative w-full h-full" style={{
                          maxWidth: isMobile
                            ? '100%'
                            : currentAgentType === 'view'
                              ? 'calc(100vw - 32px)'
                              : isRightPanelCollapsed
                                ? 'calc(100vw - 32px)'
                                : 'calc(100vw - 416px)',
                          maxHeight: isMobile
                            ? 'calc(75vh - 36px)'
                            : isRightPanelCollapsed ? '95vh' : '70vh',
                          aspectRatio: '16/9',
                          margin: isMobile ? '0' : '0 auto',
                        }}>
                          <Image
                            key={getSlideUrl()}
                            src={getSlideUrl()}
                            alt={`Slide ${params.currentSlide}`}
                            className={`
                              w-full h-full object-contain 
                              transition-all duration-300 ease-in-out
                            `}
                            priority={true}
                            width={1920}
                            height={1080}
                            onError={(e) => {
                              console.error('Error loading slide image:', getSlideUrl());
                              const target = e.target as HTMLImageElement;
                              target.onerror = null;
                              target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50%" y="50%" text-anchor="middle" fill="gray">Error loading slide</text></svg>';
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="text-gray-500">No slide available</div>
                    )}
                  </div>
                </div>
              </Panel>

              <PanelResizeHandle
                className={`${isMobile ? 'hidden' : ''} ${resizeHandleStyles.horizontal}`}
              >
                <div className="w-8 h-0.5 bg-gray-700 group-hover:bg-cyan-500 transition-colors duration-150" />
              </PanelResizeHandle>

              {/* Bottom Chat Panel */}
              <Panel
                defaultSize={isMobile ? 15 : isRightPanelCollapsed ? 15 : 30}
                minSize={isMobile ? 8 : 15}
              >
                <div className="h-full flex flex-col bg-gray-900/50 backdrop-blur-md">
                  {/* Controls */}
                  <div className={`
                    border-b border-gray-800 bg-gray-900/80 backdrop-blur-md
                    ${isMobile ? 'sticky top-0 z-10 py-0' : ''}
                  `}>
                    <div className={`
                      ${isMobile ? 'px-0.5 py-0.5' : 'px-4 py-2'} 
                      flex items-center justify-between
                      ${isMobile ? 'gap-0.5' : 'gap-2'}
                    `}>
                      <div className="flex items-center gap-3">
                        {/* Play/Stop Button */}
                        <button
                          onClick={() => {
                            if (roomState === ConnectionState.Connected) {
                              onConnect(false);
                            } else {
                              handleWalkthroughClick('view');
                            }
                          }}
                          className={`
                            ${isMobile ? 'p-1 scale-90' : 'p-2'} 
                            rounded-lg transition-colors
                            ${roomState === ConnectionState.Connected
                              ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 shadow-[0_0_15px_rgba(255,0,0,0.1)]'
                              : 'bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 shadow-[0_0_15px_rgba(0,255,255,0.1)]'
                            }
                          `}
                        >
                          {roomState === ConnectionState.Connected ? (
                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M6 6h12v12H6z" />
                            </svg>
                          ) : (
                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          )}
                        </button>

                        {/* Mic Toggle */}
                        <button
                          onClick={() => {
                            if (roomState === ConnectionState.Connected) {
                              localParticipant.setMicrophoneEnabled(!localParticipant.isMicrophoneEnabled);
                            }
                          }}
                          className={`p-2 rounded-lg transition-colors ${localParticipant?.isMicrophoneEnabled
                            ? 'bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30'
                            : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                            }`}
                          disabled={roomState !== ConnectionState.Connected}
                        >
                          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z" />
                            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                          </svg>
                        </button>
                      </div>

                      {/* Slide Navigation */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handlePrevSlide}
                          disabled={params.currentSlide === 1}
                          className="p-2 rounded-lg transition-all duration-300
                            disabled:opacity-50 disabled:cursor-not-allowed
                            bg-gray-800/50 text-gray-400 
                            hover:bg-gray-700 hover:text-cyan-400
                            hover:shadow-[0_0_15px_rgba(0,255,255,0.1)]
                            transform hover:-translate-y-0.5
                            disabled:hover:transform-none"
                        >
                          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
                          </svg>
                        </button>

                        <span className={`
                          ${isMobile ? 'text-xs' : 'text-sm'} 
                          font-medium text-gray-400 select-none
                        `}>
                          {params.currentSlide} / {params.numSlides}
                        </span>

                        <button
                          onClick={handleNextSlide}
                          disabled={params.currentSlide === params.numSlides}
                          className="p-2 rounded-lg transition-all duration-300
                            disabled:opacity-50 disabled:cursor-not-allowed
                            bg-gray-800/50 text-gray-400 
                            hover:bg-gray-700 hover:text-cyan-400
                            hover:shadow-[0_0_15px_rgba(0,255,255,0.1)]
                            transform hover:-translate-y-0.5
                            disabled:hover:transform-none"
                        >
                          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Chat Messages and Transcription */}
                  <div className={`
                    flex-1 overflow-y-auto 
                    ${isMobile ? 'p-0.5 pb-1' : 'p-2'}
                  `}>
                    {voiceAssistant?.audioTrack && (
                      <div className={`
                        transition-all duration-300
                        hover:border-cyan-500/30
                        shadow-[0_0_20px_rgba(0,255,255,0.05)]
                        hover:shadow-[0_0_30px_rgba(0,255,255,0.1)]
                        ${isMobile ? 'mx-0.5 rounded-lg' : ''}
                      `}>
                        <TranscriptionTile
                          agentAudioTrack={voiceAssistant.audioTrack}
                          accentColor="cyan"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </Panel>
            </PanelGroup>
          </div>

          {/* Right Panel - Only show on desktop in edit mode */}
          {!isMobile && currentAgentType === 'edit' && (
            <div className={`fixed right-0 top-[48px] bottom-0 w-[400px] transition-all duration-300 ${isRightPanelCollapsed ? 'translate-x-full' : 'translate-x-0'
              }`}>
              {/* Collapse Toggle Button */}
              <button
                onClick={() => setIsRightPanelCollapsed(!isRightPanelCollapsed)}
                className="absolute -left-8 top-1/2 transform -translate-y-1/2 z-10
                  w-8 h-16 bg-gray-800 rounded-l-lg flex items-center justify-center
                  text-gray-400 hover:text-white transition-colors"
              >
                <svg
                  className={`w-5 h-5 transform transition-transform ${isRightPanelCollapsed ? 'rotate-180' : ''
                    }`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>

              {/* Right Panel Content */}
              <div className="h-full flex flex-col bg-gray-900/50 backdrop-blur-md">
                {/* Tab Navigation */}
                <div className="flex border-b border-gray-800">
                  {['Agent', 'Voice', 'Workflow'].map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setConfigTab(tab.toLowerCase() as any)}
                      className={`px-4 py-2 text-xs font-medium transition-colors ${configTab === tab.toLowerCase()
                        ? 'bg-cyan-500/10 text-cyan-400 border-b-2 border-cyan-500'
                        : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800/50'
                        }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                {/* Tab Content */}
                <div className="flex-1 overflow-y-auto">
                  {/* Agent Tab */}
                  {configTab === 'agent' && (
                    <div className="relative">
                      <div className="
                        transition-all duration-300
                        hover:border-cyan-500/30
                        shadow-[0_0_20px_rgba(0,255,255,0.05)]
                        hover:shadow-[0_0_30px_rgba(0,255,255,0.1)]
                      ">
                        <SlideScriptPanel
                          currentSlide={params.currentSlide}
                          scripts={scripts}
                          onScriptChange={handleScriptChange}
                          onScriptsUpdate={updateScripts}
                          onScriptsGenerated={handleScriptsGenerated}
                          brdgeId={params.brdgeId}
                          isGenerating={isGeneratingScripts}
                        />
                      </div>
                      {isGeneratingScripts && (
                        <div className="absolute inset-0 bg-gray-900/50 backdrop-blur-sm
                          flex items-center justify-center
                          animate-[fadeIn_0.3s_ease-out]
                        ">
                          <div className="text-cyan-400 flex flex-col items-center gap-3">
                            <div className="w-8 h-8 border-2 border-current border-t-transparent
                              rounded-full animate-spin
                            "/>
                            <div className="animate-[glow_2s_ease-in-out_infinite]">
                              Generating Scripts...
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Voice Tab */}
                  {configTab === 'voice' && (
                    <div className="p-4 space-y-6">
                      <h3 className="text-[16px] font-semibold text-gray-200 tracking-tight">Voice Setup</h3>

                      {/* Voice Selection */}
                      <div className="space-y-2">
                        <select
                          className="w-full bg-gray-800/50 border border-gray-700 rounded-lg
                            px-3 py-2 text-sm text-gray-300
                            transition-all duration-300
                            focus:ring-2 focus:ring-cyan-500 focus:border-transparent
                            hover:border-cyan-500/50
                            hover:shadow-[0_0_15px_rgba(0,255,255,0.1)]"
                          value={selectedVoice || ''}
                          onChange={(e) => setSelectedVoice(e.target.value)}
                        >
                          <option value="">Create new voice</option>
                          {savedVoices.map(voice => (
                            <option key={voice.id} value={voice.id}>
                              {voice.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Voice Creation Section */}
                      {!selectedVoice && (
                        <>
                          <div className="bg-gray-800/30 rounded-lg p-4">
                            <p className="text-sm text-gray-300 leading-relaxed mb-3">
                              Create a natural-sounding AI voice clone by recording a short sample of your voice.
                            </p>
                            <ul className="space-y-2 text-sm text-gray-400">
                              <li className="flex items-start gap-2">
                                <span className="text-cyan-400 mt-0.5">•</span>
                                Record 10-20 seconds of clear speech
                              </li>
                              <li className="flex items-start gap-2">
                                <span className="text-cyan-400 mt-0.5">•</span>
                                Speak naturally at your normal pace
                              </li>
                              <li className="flex items-start gap-2">
                                <span className="text-cyan-400 mt-0.5">•</span>
                                Avoid background noise and echoes
                              </li>
                            </ul>
                          </div>

                          <div className="space-y-3">
                            <input
                              type="text"
                              value={voiceName}
                              onChange={(e) => setVoiceName(e.target.value)}
                              placeholder="Enter voice name"
                              className="w-full bg-gray-800/50 border border-gray-700 rounded-lg
                                px-3 py-2 text-sm text-gray-300
                                transition-all duration-300
                                focus:ring-2 focus:ring-cyan-500 focus:border-transparent
                                hover:border-cyan-500/50
                                hover:shadow-[0_0_15px_rgba(0,255,255,0.1)]"
                            />
                            <button
                              onClick={isRecording ? stopRecording : startRecording}
                              className={`
                                w-full px-4 py-2 rounded-lg text-sm font-medium
                                transition-all duration-300
                                flex items-center justify-center gap-2
                                transform hover:-translate-y-0.5
                                ${isRecording
                                  ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 shadow-[0_0_15px_rgba(255,0,0,0.1)]'
                                  : 'bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 shadow-[0_0_15px_rgba(0,255,255,0.1)]'
                                }
                              `}
                            >
                              <span className={`
                                w-2 h-2 rounded-full 
                                ${isRecording
                                  ? 'bg-red-500 animate-[pulse_1s_ease-in-out_infinite]'
                                  : 'bg-cyan-500'
                                }
                              `} />
                              {isRecording ? (
                                <>Stop Recording ({formatTime(recordingTime)})</>
                              ) : (
                                <>Record Voice</>
                              )}
                            </button>

                            {currentRecording && (
                              <div className="space-y-3">
                                <audio
                                  src={URL.createObjectURL(currentRecording)}
                                  controls
                                  className="w-full h-8"
                                />
                                <button
                                  onClick={handleCloneVoice}
                                  disabled={!voiceName || isCloning}
                                  className={`
                                    w-full px-4 py-2 rounded-lg text-sm font-medium
                                    transition-all duration-300
                                    transform hover:-translate-y-0.5
                                    bg-cyan-500/20 text-cyan-400 
                                    hover:bg-cyan-500/30 
                                    shadow-[0_0_15px_rgba(0,255,255,0.1)]
                                    disabled:opacity-50 disabled:cursor-not-allowed
                                    disabled:hover:transform-none
                                  `}
                                >
                                  {isCloning ? 'Creating Voice Clone...' : 'Create Voice Clone'}
                                </button>
                              </div>
                            )}
                          </div>
                        </>
                      )}

                      {/* Selected Voice Details */}
                      {selectedVoice && savedVoices.find(v => v.id === selectedVoice) && (
                        <div className="bg-gray-800/30 rounded-lg p-3 space-y-2">
                          {(() => {
                            const voice = savedVoices.find(v => v.id === selectedVoice);
                            return voice ? (
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm text-gray-400">Name</span>
                                  <span className="text-sm text-cyan-400">{voice.name}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-sm text-gray-400">Created</span>
                                  <span className="text-sm text-cyan-400">
                                    {new Date(voice.created_at).toLocaleDateString()}
                                  </span>
                                </div>
                              </div>
                            ) : null;
                          })()}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Workflow Tab */}
                  {configTab === 'workflow' && (
                    <div className="p-4 space-y-6">
                      {/* Getting Started Section */}
                      <div className="space-y-4">
                        <h3 className="text-[16px] font-semibold text-gray-200 tracking-tight">Recording Walkthrough</h3>

                        <div className="relative px-4">
                          <div className="absolute top-4 left-0 right-0 h-0.5 bg-gray-800" />
                          <div className="relative z-10 flex justify-between">
                            {[
                              {
                                step: 1,
                                title: "Present",
                                description: [
                                  "Walk through your slides",
                                  "Explain naturally",
                                  "Take your time"
                                ]
                              },
                              {
                                step: 2,
                                title: "Interact",
                                description: [
                                  "Answer AI questions",
                                  "Provide context",
                                  "Clarify details"
                                ]
                              },
                              {
                                step: 3,
                                title: "Review",
                                description: [
                                  "Check accuracy",
                                  "Verify content",
                                  "Approve scripts"
                                ]
                              }
                            ].map(({ step, title, description }) => (
                              <div key={step} className="flex flex-col items-center w-1/3">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center mb-3
                                  ${step <= currentStep
                                    ? 'bg-cyan-500/20 text-cyan-400'
                                    : 'bg-gray-800 text-gray-500'
                                  }`}>
                                  {step}
                                </div>
                                <div className="text-center space-y-2">
                                  <p className="text-sm font-medium text-gray-300">{title}</p>
                                  <div className="space-y-1">
                                    {description.map((text, idx) => (
                                      <p key={idx} className="text-xs text-gray-400 font-light">{text}</p>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Walkthrough Controls */}
                      <div className="space-y-4">
                        <select
                          key={`walkthrough-selector-${forceRefresh}`}
                          ref={walkthroughSelectorRef}
                          className="w-full bg-gray-800/50 border border-gray-700 rounded-lg
                            px-3 py-2 text-sm text-gray-300
                            focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500"
                          value={selectedWalkthrough || ''}
                          onChange={(e) => handleWalkthroughSelect(Number(e.target.value))}
                        >
                          <option value="">Select a walkthrough</option>
                          {walkthroughs.map((w, index) => (
                            <option
                              key={`${w.id}-${forceRefresh}`}
                              value={w.id}
                            >
                              Walkthrough #{walkthroughs.length - index}
                            </option>
                          ))}
                        </select>

                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              if (roomState === ConnectionState.Connected) {
                                onConnect(false);
                              } else {
                                handleWalkthroughClick('edit');
                              }
                            }}
                            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium 
                              transition-colors flex items-center justify-center gap-2
                              ${roomState === ConnectionState.Connected
                                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                                : 'bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30'
                              }`}
                          >
                            {roomState === ConnectionState.Connected ? (
                              <>
                                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                Stop Walkthrough
                              </>
                            ) : (
                              'Record Walkthrough'
                            )}
                          </button>
                          <button
                            onClick={handleGenerateScripts}
                            disabled={!selectedWalkthrough || isGeneratingScripts}
                            className="flex-1 px-3 py-2 bg-cyan-500/20 text-cyan-400
                              rounded-lg text-sm font-medium hover:bg-cyan-500/30 transition-colors
                              disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isGeneratingScripts ? 'Generating...' : 'Generate Scripts'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </PanelGroup>
      </div>

      {isMobile && currentAgentType === 'edit' && (
        <button
          onClick={() => setIsConfigDrawerOpen(true)}
          className="fixed right-2 top-[40px] z-40 p-1.5 rounded-lg 
            bg-gray-800/80 backdrop-blur-sm text-gray-400
            hover:text-cyan-400 transition-colors
            scale-90
          "
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      )}

      {isMobile && (
        <MobileConfigDrawer
          isOpen={isConfigDrawerOpen}
          onClose={() => setIsConfigDrawerOpen(false)}
          configTab={configTab}
          setConfigTab={setConfigTab}
        >
          {configTab === 'agent' && (
            <div className="relative">
              <div className="
                transition-all duration-300
                hover:border-cyan-500/30
                shadow-[0_0_20px_rgba(0,255,255,0.05)]
                hover:shadow-[0_0_30px_rgba(0,255,255,0.1)]
              ">
                <SlideScriptPanel
                  currentSlide={params.currentSlide}
                  scripts={scripts}
                  onScriptChange={handleScriptChange}
                  onScriptsUpdate={updateScripts}
                  onScriptsGenerated={handleScriptsGenerated}
                  brdgeId={params.brdgeId}
                  isGenerating={isGeneratingScripts}
                />
              </div>
              {isGeneratingScripts && (
                <div className="absolute inset-0 bg-gray-900/50 backdrop-blur-sm
                  flex items-center justify-center
                  animate-[fadeIn_0.3s_ease-out]
                ">
                  <div className="text-cyan-400 flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-current border-t-transparent
                      rounded-full animate-spin
                    "/>
                    <div className="animate-[glow_2s_ease-in-out_infinite]">
                      Generating Scripts...
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          {configTab === 'voice' && (
            <div className="p-4 space-y-6">
              {/* Voice Configuration Content */}
              <div className="space-y-4">
                <select
                  value={selectedVoice || ''}
                  onChange={(e) => setSelectedVoice(e.target.value)}
                  className="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2"
                >
                  <option value="">Select Voice</option>
                  {savedVoices.map(voice => (
                    <option key={voice.id} value={voice.id}>{voice.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {configTab === 'workflow' && (
            <div className="p-4 space-y-6">
              {/* Workflow Configuration Content */}
              <div className="space-y-4">
                <select
                  value={selectedWalkthrough || ''}
                  onChange={(e) => handleWalkthroughSelect(Number(e.target.value))}
                  className="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2"
                >
                  <option value="">Select Walkthrough</option>
                  {walkthroughs.map((w, index) => (
                    <option key={w.id} value={w.id}>
                      Walkthrough #{walkthroughs.length - index}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </MobileConfigDrawer>
      )}
    </div>
  );
}
