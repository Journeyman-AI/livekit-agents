"use client";

import { LoadingSVG } from "@/components/button/LoadingSVG";
import { ChatMessageType, ChatTile } from "@/components/chat/ChatTile";
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
  useChat
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

export interface PlaygroundProps {
  logo?: ReactNode;
  themeColors: string[];
  onConnect: (connect: boolean, opts?: { token: string; url: string }) => void;
}

const headerHeight = 56;

// Add interface for metadata
interface BrdgeMetadata {
  id: string;
  name: string;
  numSlides: number;
}

// Add interface for scripts
interface SlideScripts {
  [key: string]: string;
}

interface ScriptData {
  slide_scripts: SlideScripts;
  generated_at: string;
  source_walkthrough_id: string;
}

// First, add this type near the top of the file
type AgentType = 'edit' | 'view';

// Add interface for JWT payload
interface JWTPayload {
  sub: string;  // subject (user id)
  exp: number;  // expiration time
  iat: number;  // issued at
}

// Add this at the top with other hooks
const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkIsMobile = () => {
      setIsMobile(window.innerWidth < 640); // sm breakpoint
    };

    // Initial check
    checkIsMobile();

    // Add event listener
    window.addEventListener('resize', checkIsMobile);

    // Cleanup
    return () => window.removeEventListener('resize', checkIsMobile);
  }, []);

  return isMobile;
};

// Add mobile tab type
type MobileTab = 'chat' | 'script' | 'voice' | 'info';

export default function Playground({
  logo,
  themeColors,
  onConnect,
}: PlaygroundProps) {
  const isMobile = useIsMobile();

  // URL parameters state
  const [params, setParams] = useState({
    brdgeId: null as string | null,
    numSlides: 0,
    apiBaseUrl: null as string | null,
    coreApiUrl: API_BASE_URL,
    currentSlide: 1,
    userId: null as string | null
  });

  // Update params setup to extract just the numeric ID
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
          jwtDecode<JWTPayload>(token).sub : // Just use the numeric ID directly
          `anon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };

      console.log('Setting initial params:', newParams);
      setParams(newParams);
    }
  }, []);

  // Rest of the state declarations
  const { config, setUserSettings } = useConfig();
  const { name } = useRoomInfo();
  const { localParticipant } = useLocalParticipant();
  const voiceAssistant = useVoiceAssistant();
  const roomState = useConnectionState();
  const [transcripts, setTranscripts] = useState<ChatMessageType[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);

  // Refs
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSentSlide = useRef<number | null>(null);

  // Data channel setup with DataPacket_Kind
  const { send } = useDataChannel<"slide_updates">((message) => {
    console.log("Received message on slide_updates channel:", message);
    try {
      const decoded = JSON.parse(new TextDecoder().decode(message));
      if (decoded.type === "SCRIPTS_UPDATED") {
        // Refresh scripts if needed
        loadInitialScripts();
      }
    } catch (error) {
      console.error("Error processing data channel message:", error);
    }
  }, "slide_updates");

  // Add brdgeMetadata state
  const [brdgeMetadata, setBrdgeMetadata] = useState<BrdgeMetadata | null>(null);

  // Add state for info visibility
  const [showInfo, setShowInfo] = useState(true);

  // Hide info when walkthrough starts
  useEffect(() => {
    if (roomState === ConnectionState.Connected) {
      setShowInfo(false);
    } else {
      setShowInfo(true);
    }
  }, [roomState]);

  // Add state to track current agent type
  const [currentAgentType, setCurrentAgentType] = useState<AgentType>('edit');

  // Add useEffect to handle URL parameters
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const agentType = urlParams.get('agentType') as AgentType;
      if (agentType && (agentType === 'edit' || agentType === 'view')) {
        setCurrentAgentType(agentType);
        console.log('Setting agent type:', agentType);
      }
    }
  }, []);

  // Move state declarations to the top
  const [selectedWalkthrough, setSelectedWalkthrough] = useState<number | null>(null);
  const [scripts, setScripts] = useState<SlideScripts | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [editingSlide, setEditingSlide] = useState<string | null>(null);
  const [editedScripts, setEditedScripts] = useState<Record<string, string>>({});
  const [hasScriptChanges, setHasScriptChanges] = useState(false);
  const [isGeneratingScripts, setIsGeneratingScripts] = useState(false);
  const [walkthroughs, setWalkthroughs] = useState<any[]>([]);

  // Add a function to load walkthroughs
  const loadWalkthroughs = useCallback(async () => {
    if (!params.brdgeId) return;
    try {
      const response = await api.get(`/brdges/${params.brdgeId}/walkthrough-list`);
      if (response.data.has_walkthroughs) {
        const sortedWalkthroughs = response.data.walkthroughs.sort(
          (a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        setWalkthroughs(sortedWalkthroughs);
      }
    } catch (error) {
      console.error('Error loading walkthroughs:', error);
    }
  }, [params.brdgeId]);

  // Single onDataReceived handler that handles both transcription and walkthrough completion
  const onDataReceived = useCallback(
    (msg: any) => {
      if (msg.topic === "transcription") {
        const decoded = JSON.parse(
          new TextDecoder("utf-8").decode(msg.payload)
        );
        let timestamp = new Date().getTime();
        if ("timestamp" in decoded && decoded.timestamp > 0) {
          timestamp = decoded.timestamp;
        }
        setTranscripts(prev => [...prev, {
          name: "You",
          message: decoded.text,
          timestamp: timestamp,
          isSelf: true,
        }]);
      } else {
        try {
          const decoded = JSON.parse(new TextDecoder("utf-8").decode(msg.payload));
          if (decoded.type === "WALKTHROUGH_COMPLETED") {
            // Just reload the walkthroughs
            loadWalkthroughs();
          }
        } catch (e) {
          console.error("Error decoding message:", e);
        }
      }
    },
    [loadWalkthroughs]  // Add loadWalkthroughs to dependencies
  );

  // Use the data channel
  useDataChannel(onDataReceived);

  // Initial load of walkthroughs
  useEffect(() => {
    loadWalkthroughs();
  }, [loadWalkthroughs]);

  // Single handleWalkthroughClick implementation
  const handleWalkthroughClick = useCallback(async (agentType: AgentType = 'edit') => {
    try {
      setIsConnecting(true);
      setCurrentAgentType(agentType);
      if (roomState === ConnectionState.Disconnected) {
        await onConnect(true);
        setRightPanelView('chat');
      } else {
        await onConnect(false);
        // After disconnecting, refresh the page
        window.location.reload();
      }
    } catch (error) {
      console.error('Connection error:', error);
    } finally {
      setIsConnecting(false);
    }
  }, [roomState, onConnect]);

  // Modify the handleGenerateClick function
  const handleGenerateClick = async () => {
    if (!selectedWalkthrough) return;

    setIsGeneratingScripts(true);
    try {
      // Generate scripts
      const response = await api.post(`/brdges/${params.brdgeId}/generate-slide-scripts`, {
        walkthrough_id: selectedWalkthrough
      });

      if (response.data.scripts) {
        // Update scripts state with new scripts
        setScripts(response.data.scripts);

        // Notify parent of script update
        onScriptsGenerated?.(response.data.scripts);

        // Force a re-render of the script panel
        setParams(prev => ({ ...prev, currentSlide: prev.currentSlide }));
      } else {
        console.error('No scripts returned from generation');
      }
    } catch (error) {
      console.error('Error generating scripts:', error);
    } finally {
      setIsGeneratingScripts(false);
    }
  };

  // Add handler for script generation completion
  const handleScriptsGenerated = useCallback((newScripts: Record<string, any>) => {
    setScripts(newScripts);

    // Only try to send if we have a valid data channel and are connected
    if (send && roomState === ConnectionState.Connected) {
      try {
        const message = {
          type: "SCRIPTS_UPDATED",
          brdgeId: params.brdgeId,
          timestamp: Date.now()
        };
        send(new TextEncoder().encode(JSON.stringify(message)), { reliable: true });
        console.log('Sent script update notification');
      } catch (error) {
        console.error('Error sending script update:', error);
      }
    }
  }, [send, roomState, params.brdgeId]); // Add dependencies

  // Add loadInitialScripts as a named function
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

  // Update the initial scripts effect to use the named function
  useEffect(() => {
    loadInitialScripts();
  }, [loadInitialScripts]);

  // Add the handler function
  const handleWalkthroughSelect = useCallback((walkthroughId: number) => {
    setSelectedWalkthrough(walkthroughId);
  }, []);

  // Update sendSlideUpdate to use the stored agent type
  const sendSlideUpdate = useCallback(() => {
    if (!params.brdgeId || roomState !== ConnectionState.Connected) {
      return;
    }

    // Clear any pending timeout
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
    }

    // Only send if the slide has changed or hasn't been sent yet
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
            console.log("Sent slide update:", message);
          }
        } catch (e) {
          console.error("Error sending slide update:", e);
        }
      }, 300);
    }
  }, [params, roomState, send, currentAgentType]);

  // Simplify the connection effect
  useEffect(() => {
    if (roomState === ConnectionState.Connected && params.brdgeId) {
      // Reset lastSentSlide to force an initial update
      lastSentSlide.current = null;
      sendSlideUpdate();
    }
  }, [roomState, params.brdgeId, sendSlideUpdate]);

  // Clean up timeouts on unmount or disconnect
  useEffect(() => {
    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
      // Reset the last sent slide
      lastSentSlide.current = null;
    };
  }, [roomState]);

  // Handle slide navigation
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

  // Validate required parameters
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
      [slideId]: newScript,
    }));
    setHasScriptChanges(true);
  }, []);

  // We should also add a function to update the main scripts state
  const updateScripts = useCallback((newScripts: Record<string, string>) => {
    setScripts(newScripts);
    setEditedScripts({}); // Clear edited scripts
    setHasScriptChanges(false);
  }, []);

  // Function to save changes to the database
  const saveScriptChanges = async () => {
    try {
      await api.put(`/brdges/${params.brdgeId}/scripts/update`, {
        scripts: editedScripts,
      });
      // Update the scripts state with the edited version
      setScripts(editedScripts);
      setHasScriptChanges(false);
      console.log('Scripts updated successfully');
    } catch (error) {
      console.error('Error updating scripts:', error);
    }
  };

  // Update the hook name
  const chat = useChat();

  const chatTileContent = useMemo(() => {
    return (
      <div className="flex flex-col h-full max-h-full overflow-hidden">
        <div className="flex-grow overflow-y-auto min-h-0">
          <ChatTile
            messages={transcripts}
            accentColor={config.settings.theme_color}
            onSend={async (message) => {
              if (chat) {
                return chat.send(message);
              }
            }}
          />
          {voiceAssistant.audioTrack && (
            <TranscriptionTile
              agentAudioTrack={voiceAssistant.audioTrack}
              accentColor={config.settings.theme_color}
            />
          )}
        </div>
        {/* Voice input controls */}
        {localParticipant && !isMobile && (
          <div className="border-t border-gray-700 p-4 flex-shrink-0">
            <ConfigurationPanelItem
              title="Voice Input"
              deviceSelectorKind="audioinput"
            >
              <AudioInputTile
                trackRef={{
                  source: Track.Source.Microphone,
                  participant: localParticipant
                }}
              />
            </ConfigurationPanelItem>
          </div>
        )}
      </div>
    );
  }, [
    transcripts,
    voiceAssistant.audioTrack,
    config.settings.theme_color,
    localParticipant,
    chat,
    isMobile
  ]);

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
    console.log('Loading slide:', slideUrl);

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
                      // Stop the session
                      onConnect(false);
                      setRightPanelView('info');
                    } else {
                      // Start the session
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
        {/* FOR MOBILE ONLY: Replace script display with chat + transcription */}
        {!isMobile && (
          <SlideScriptPanel
            currentSlide={params.currentSlide}
            scripts={scripts}
            onScriptChange={handleScriptChange}
            onScriptsUpdate={updateScripts}
            onScriptsGenerated={handleScriptsGenerated}
            brdgeId={params.brdgeId}
            isGenerating={isGeneratingScripts}
          />
        )}
      </div>
    );
  }, [params, roomState, hasRequiredParams, scripts, isGenerating, currentAgentType, handleScriptChange, updateScripts]);

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

  let mobileTabs: PlaygroundTab[] = [];

  mobileTabs.push({
    title: "Slides",
    content: (
      <PlaygroundTile
        className="w-full h-full grow"
        childrenClassName="justify-center"
      >
        {slideTileContent}
      </PlaygroundTile>
    ),
  });

  if (config.settings.outputs.audio) {
    mobileTabs.push({
      title: "Audio",
      content: (
        <PlaygroundTile
          className="w-full h-full grow"
          childrenClassName="justify-center"
        >
          {audioTileContent}
        </PlaygroundTile>
      ),
    });
  }

  if (config.settings.chat) {
    mobileTabs.push({
      title: "Chat",
      content: chatTileContent,
    });
  }

  mobileTabs.push({
    title: "Settings",
    content: (
      <PlaygroundTile
        padding={false}
        backgroundColor="gray-950"
        className="h-full w-full basis-1/4 items-start overflow-y-auto flex"
        childrenClassName="h-full grow items-start"
      >
        {settingsTileContent}
      </PlaygroundTile>
    ),
  });

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
    console.log('Current params:', params);
  }, [params]);

  useEffect(() => {
    const checkExistingScripts = async () => {
      if (!params.brdgeId) {
        console.log('No brdgeId available');
        return;
      }

      try {
        console.log('Fetching scripts from:', `/brdges/${params.brdgeId}/scripts`);

        const response = await api.get(`/brdges/${params.brdgeId}/scripts`);

        if (response.data.has_scripts) {
          console.log('Found existing scripts:', response.data.scripts);
          setScripts(response.data.scripts);
          setEditedScripts(response.data.scripts);

          const walkthrough_id = parseInt(response.data.metadata.source_walkthrough_id);
          if (walkthrough_id) {
            setSelectedWalkthrough(walkthrough_id);
          }
        } else {
          console.log('No existing scripts found');
        }
      } catch (error) {
        console.error('Error checking for existing scripts:', error, {
          brdgeId: params.brdgeId,
          url: `/brdges/${params.brdgeId}/scripts`
        });
      }
    };

    checkExistingScripts();
  }, [params.brdgeId]);

  const [rightPanelView, setRightPanelView] = useState<'chat' | 'info'>('info');

  const renderRightPanelContent = () => {
    return (
      <div className="flex-1 overflow-hidden">
        <div className={`h-full flex flex-col ${rightPanelView === 'chat' ? 'block' : 'hidden'}`}>
          <div className="flex-1 overflow-y-auto">
            <div className="p-4">
              {voiceAssistant?.audioTrack && (
                <TranscriptionTile
                  agentAudioTrack={voiceAssistant.audioTrack}
                  accentColor="cyan"
                />
              )}
            </div>
          </div>
        </div>

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

  const walkthroughSelectorRef = useRef<{ refreshWalkthroughs: () => void }>(null);

  return (
    <div className="h-[calc(100vh-1px)] flex flex-col bg-[#121212] relative overflow-hidden">
      {currentAgentType === 'edit' ? (
        <PlaygroundHeader
          title={brdgeMetadata?.name || params.brdgeId || 'Loading...'}
          height={headerHeight}
          connectionState={roomState}
          walkthroughCount={walkthroughs.length}
          brdgeId={params.brdgeId}
          apiBaseUrl={params.coreApiUrl}
          selectedWalkthrough={selectedWalkthrough}
          onWalkthroughClick={handleWalkthroughClick}
          onGenerateClick={handleGenerateClick}
          onWalkthroughSelect={handleWalkthroughSelect}
          showEditControls={true}
          isGenerating={isGeneratingScripts}
          walkthroughSelectorRef={walkthroughSelectorRef}
        />
      ) : (
        <ViewerHeader
          title={brdgeMetadata?.name || params.brdgeId || 'Loading...'}
          height={headerHeight}
          currentSlide={params.currentSlide}
          totalSlides={params.numSlides}
          connectionState={roomState}
        />
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className={`
          flex-1 
          ${currentAgentType === 'view' ? 'w-full' : ''}
          ${isMobile ? 'flex flex-col p-0 h-[calc(100vh-57px)]' : 'p-6'}
          overflow-y-auto
        `}>
          <div className={`
            flex flex-col
            ${isMobile ? 'h-[35vh] min-h-[250px]' : 'h-full'}
          `}>
            <div className="flex-1 relative bg-black overflow-hidden">
              {getSlideUrl() ? (
                <Image
                  key={getSlideUrl()}
                  src={getSlideUrl()}
                  alt={`Slide ${params.currentSlide}`}
                  className="w-full h-full object-contain"
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
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gray-900 text-gray-500">
                  No slide available
                </div>
              )}
            </div>

            <div className="flex-shrink-0 h-[60px] bg-gray-900 border-t border-gray-800">
              <div className="h-full px-4 flex justify-between items-center">
                <span className="text-gray-400 text-sm">
                  Slide {params.currentSlide} of {params.numSlides}
                </span>
                <div className="flex gap-2">
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
                      className={`px-3 py-1.5 ${roomState === ConnectionState.Connected
                        ? 'bg-red-600 hover:bg-red-700'
                        : 'bg-green-600 hover:bg-green-700'
                        } text-white rounded-md transition-colors flex items-center gap-1 text-sm whitespace-nowrap`}
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
                          <span>Stop</span>
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
                          <span>Play</span>
                        </>
                      )}
                    </button>
                  )}

                  <button
                    onClick={handlePrevSlide}
                    disabled={params.currentSlide === 1}
                    className="px-3 py-1.5 bg-gray-800 text-white rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm whitespace-nowrap"
                  >
                    Previous
                  </button>
                  <button
                    onClick={handleNextSlide}
                    disabled={params.currentSlide === params.numSlides}
                    className="px-3 py-1.5 bg-gray-800 text-white rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm whitespace-nowrap"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Add back the desktop script panel */}
          {!isMobile && currentAgentType === 'edit' && (
            <div className="border-t border-gray-800">
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
          )}

          {isMobile && roomState === ConnectionState.Connected && currentAgentType === 'edit' && (
            <div className="flex-1 min-h-[45vh] border-t border-gray-800 bg-gray-900 flex flex-col">
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
          )}
        </div>

        {!isMobile && (
          <div className="w-[320px] border-l border-gray-800 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-gray-800 flex items-center gap-4">
              <button
                onClick={() => {
                  if (roomState === ConnectionState.Connected) {
                    localParticipant.setMicrophoneEnabled(!localParticipant.isMicrophoneEnabled);
                  }
                }}
                className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors flex-shrink-0
                  ${localParticipant.isMicrophoneEnabled
                    ? 'bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
              >
                <span className={`w-2 h-2 rounded-full ${localParticipant.isMicrophoneEnabled ? 'bg-cyan-500 animate-pulse' : 'bg-gray-600'}`} />
                <span className="text-sm font-medium">
                  {localParticipant.isMicrophoneEnabled ? 'Mic On' : 'Mic Off'}
                </span>
              </button>

              {roomState === ConnectionState.Connected && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setRightPanelView('chat')}
                    className={`px-3 py-2 text-sm rounded-md transition-colors ${rightPanelView === 'chat'
                      ? 'bg-cyan-500/20 text-cyan-400'
                      : 'text-gray-400 hover:text-gray-300'}`}
                  >
                    Chat
                  </button>
                  <button
                    onClick={() => setRightPanelView('info')}
                    className={`px-3 py-2 text-sm rounded-md transition-colors ${rightPanelView === 'info'
                      ? 'bg-cyan-500/20 text-cyan-400'
                      : 'text-gray-400 hover:text-gray-300'}`}
                  >
                    Info
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-hidden">
              <div className={`h-full flex flex-col ${rightPanelView === 'chat' ? 'block' : 'hidden'}`}>
                <div className="flex-1 overflow-y-auto">
                  <div className="p-4">
                    {voiceAssistant?.audioTrack && (
                      <TranscriptionTile
                        agentAudioTrack={voiceAssistant.audioTrack}
                        accentColor="cyan"
                      />
                    )}
                  </div>
                </div>
              </div>

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

            <div className="p-3 bg-gray-900 border-t border-gray-800">
              <div className="flex items-center justify-between text-sm text-gray-400">
                <span>
                  {currentAgentType === 'edit' && walkthroughs.length > 0 && `Walkthrough #${walkthroughs.length}`}
                  {currentAgentType === 'view' && 'View Mode'}
                </span>
                <span className="flex items-center gap-2">
                  {roomState === ConnectionState.Connected && (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
                      {currentAgentType === 'edit' ? 'Walkthrough in Progress' : 'Viewing'}
                    </>
                  )}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
