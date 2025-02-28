"use client";
import { ChatMessageType } from "@/components/chat/ChatTile";
import { TranscriptionTile } from "@/transcriptions/TranscriptionTile";
import {
  useConnectionState,
  useDataChannel,
  useLocalParticipant,
  useVoiceAssistant,
  useChat,
} from "@livekit/components-react";
import { ConnectionState, LocalParticipant, Track, DataPacket_Kind } from "livekit-client";
import { ReactNode, useCallback, useEffect, useMemo, useState, useRef } from "react";
import { API_BASE_URL } from '@/config';
import { api } from '@/api';
import { jwtDecode } from "jwt-decode";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle
} from 'react-resizable-panels';
import { Plus, FileText, X, Edit2, Save, ChevronDown, ChevronUp, Play, Pause, Volume2, VolumeX, Maximize2, Mic, MicOff, Radio, ChevronRight, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import styled, { keyframes } from 'styled-components';

export interface PlaygroundProps {
  logo?: ReactNode;
  themeColors: string[];
  onConnect: (connect: boolean, opts?: { token: string; url: string }) => void;
  agentType?: 'edit' | 'view';  // Add this line
}

// Update the header height constant at the top of the file
const headerHeight = 16; // Changed from 28 to 16

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

interface SavedVoice {
  id: string;
  name: string;
  created_at: string;
  status: string;
}

type MobileTab = 'chat' | 'script' | 'voice' | 'info';
type ConfigTab = 'ai-agent' | 'voice-clone' | 'chat';

interface DataChannelMessage {
  payload: Uint8Array;
  topic?: string;
  kind?: DataPacket_Kind;
}

interface ScriptContent {
  script: string;
  agent: string;
}

interface RecordingData {
  url: string;
  format: string;
  duration: number;
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
}

interface TranscriptWord {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  confidence?: number;
}

interface TranscriptContent {
  transcript: string;
  segments: Array<{
    text: string;
    start: number;
    end: number;
  }>;
  words: TranscriptWord[];
}

interface Transcript {
  content: TranscriptContent;
  status: string;
  metadata: any;
}

interface DataChannelPayload {
  transcript_position?: {
    read: string[];
    remaining: string[];
  };
  // Add other payload types as needed
}

// Update the useIsMobile hook to also detect orientation
const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);

  useEffect(() => {
    const checkLayout = () => {
      setIsMobile(window.innerWidth < 640);
      setIsLandscape(window.innerWidth > window.innerHeight);
    };

    checkLayout();
    window.addEventListener('resize', checkLayout);
    window.addEventListener('orientationchange', checkLayout);
    return () => {
      window.removeEventListener('resize', checkLayout);
      window.removeEventListener('orientationchange', checkLayout);
    };
  }, []);

  return { isMobile, isLandscape };
};

const styles = {
  heading: `font-satoshi text-[20px] font-medium tracking-[-0.02em] text-white/90`,
  subheading: `font-satoshi text-[16px] font-normal tracking-[-0.01em] text-white/80`,
  sectionTitle: `font-satoshi text-[13px] font-medium tracking-[-0.01em] text-white/90`,
  label: `font-satoshi text-[11px] font-normal tracking-wide text-gray-400/70`,
  input: {
    base: `
      font-satoshi w-full
      bg-[#1E1E1E]/50 backdrop-blur-sm
      border border-gray-800/50 rounded-lg
      px-3 py-2.5 text-[14px] leading-relaxed
      text-white
      transition-all duration-300
      focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/30
      focus:shadow-[0_0_15px_rgba(34,211,238,0.1)]
      hover:border-cyan-500/20
      placeholder:text-gray-600/50
    `,
    textarea: `
      min-h-[120px] resize-none
      bg-transparent
      border border-gray-800/50 rounded-lg
      transition-all duration-300
      focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/30
      focus:shadow-[0_0_15px_rgba(34,211,238,0.1)]
      hover:border-cyan-500/20
      scrollbar-thin scrollbar-track-transparent scrollbar-thumb-gray-700/30
      hover:scrollbar-thumb-cyan-500/20
      text-shadow-[0_0_10px_rgba(34,211,238,0.3)]
    `
  },
  button: {
    primary: `
      group
      flex items-center gap-2
      px-4 py-2 rounded-lg text-[13px]
      bg-gradient-to-r from-cyan-500/10 to-cyan-400/5
      text-cyan-400
      border border-cyan-500/20
      transition-all duration-300
      hover:border-cyan-400/40
      hover:shadow-[0_0_15px_rgba(34,211,238,0.15)]
      hover:bg-gradient-to-r hover:from-cyan-500/20 hover:to-cyan-400/10
    `,
    icon: `
      p-1.5 rounded-md
      transition-all duration-300
      hover:bg-cyan-500/10
      hover:shadow-[0_0_10px_rgba(34,211,238,0.15)]
      group-hover:text-cyan-400
    `
  },
  tab: {
    base: `
      relative px-4 py-2 
      font-satoshi text-[13px] font-medium tracking-[-0.01em]
      transition-all duration-300
    `,
    active: `
    text-cyan-400
      after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px]
      after:bg-gradient-to-r after:from-cyan-500/80 after:to-cyan-400/20
      after:shadow-[0_0_8px_rgba(34,211,238,0.3)]
    `,
    inactive: `text-gray-400/70 hover:text-gray-300`
  },
  voiceClone: {
    title: `font-satoshi text-[13px] font-medium tracking-[-0.01em] text-white/90 mb-4`,
    subtitle: `font-satoshi text-[12px] font-medium tracking-[-0.01em] text-gray-300/90 mb-3`,
    instruction: `font-satoshi text-[12px] leading-relaxed tracking-wide text-gray-400/80`,
    sampleText: `
      font-satoshi text-[12px] leading-relaxed tracking-wide
      bg-black/20 rounded-lg p-3
      border border-gray-800
      text-gray-300/80
    `
  },
  knowledgeBase: {
    bubble: `
      relative z-10
      bg-[#1E1E1E]/50 backdrop-blur-sm
      border border-gray-800/50 rounded-lg p-2.5
    transition-all duration-300
      hover:border-cyan-500/30
      hover:shadow-[0_0_15px_rgba(34,211,238,0.07)]
      before:absolute before:inset-0 before:z-[-1]
      before:bg-gradient-to-r before:from-cyan-500/[0.02] before:to-transparent
      before:opacity-0 before:transition-opacity before:duration-300
      hover:before:opacity-100
      cursor-pointer
  `,
    input: `
      flex-1 bg-transparent z-20
      font-satoshi text-[13px] text-gray-300
      border border-gray-700/50 rounded-md px-2 py-1
      focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/30
      hover:border-cyan-500/20
    transition-all duration-300
    `,
    content: `
      w-full bg-black/20 z-20
      font-satoshi text-[13px] text-gray-300
      border border-gray-800/50 rounded-lg
      p-2 min-h-[45px]
      focus:ring-1 focus:ring-cyan-500/50
      focus:border-cyan-500/30
      hover:border-cyan-500/20
      resize-none
      transition-all duration-300
    `
  },
  card: {
    base: `
      bg-[#1E1E1E] 
      border border-gray-800
      rounded-lg p-2.5
      transition-all duration-300
      hover:border-cyan-500/30
      hover:shadow-[0_0_20px_rgba(34,211,238,0.1)]
      backdrop-blur-sm
    `,
    active: `
      border-cyan-500/30
      shadow-[0_0_20px_rgba(34,211,238,0.1)]
      bg-gradient-to-b from-cyan-500/10 to-transparent
    `
  },
  section: {
    wrapper: `
      relative p-2
      before:absolute before:inset-0
      before:border before:border-gray-800/50 before:rounded-lg
      before:transition-all before:duration-300
      hover:before:border-cyan-500/20
      hover:before:shadow-[0_0_20px_rgba(34,211,238,0.05)]
      after:absolute after:inset-0
      after:bg-gradient-to-b after:from-cyan-500/[0.02] after:to-transparent
      after:opacity-0 after:transition-opacity after:duration-300
      hover:after:opacity-100
      rounded-lg
      mb-2
    `,
    title: `
      font-satoshi text-[14px] font-medium tracking-[-0.01em] 
      text-white/90 mb-2
      flex items-center gap-2
      before:content-[''] before:w-1 before:h-1 before:rounded-full
      before:bg-cyan-400/50 before:shadow-[0_0_5px_rgba(34,211,238,0.5)]
    `
  },
  divider: `
    h-px w-full
    bg-gradient-to-r from-transparent via-gray-800/50 to-transparent
    my-6
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

const MobileConfigDrawer = ({
  isOpen,
  onClose,
  configTab,
  setConfigTab,
  children
}: {
  isOpen: boolean;
  onClose: () => void;
  configTab: ConfigTab;
  setConfigTab: (tab: ConfigTab) => void;
  children: ReactNode;
}) => {
  return (
    <div
      className={`
        fixed inset-0 z-50 
        transition-all duration-300 ease-in-out
        ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}
      `}
    >
      {/* Rest of the MobileConfigDrawer implementation */}
    </div>
  );
};

// First, let's update the AgentConfig interface to include structured personality
interface AgentConfig {
  personality: string;
  agentPersonality?: {
    name: string;
    expertise: string[];
    knowledge_areas: Array<{
      topic: string;
      confidence_level: string;
      key_talking_points: string[];
    }>;
    persona_background: string;
    response_templates: {
      greeting?: string | null;
      not_sure?: string | null;
      follow_up_questions?: string[];
    };
    communication_style: string;
    voice_characteristics?: {
      pace?: string;
      tone?: string;
      common_phrases?: string[];
      emphasis_patterns?: string;
    };
  };
  knowledgeBase: Array<{
    id: string;
    type: string;
    name: string;
    content: string;
  }>;
}

// Add new interfaces for knowledge management
interface KnowledgeBubbleProps {
  entry: AgentConfig['knowledgeBase'][0];
  onEdit: (id: string, content: string, name?: string) => void;
  onRemove: (id: string) => void;
}

// Add this new component for knowledge bubbles
const KnowledgeBubble: React.FC<KnowledgeBubbleProps> = ({ entry, onEdit, onRemove }) => {
  const [content, setContent] = useState(entry.content);
  const [isExpanded, setIsExpanded] = useState(false);

  // Auto-update name based on content
  useEffect(() => {
    const newName = content.trim().slice(0, 20) + (content.length > 20 ? '...' : '');
    if (newName !== entry.name && content.trim() !== '') {
      onEdit(entry.id, content, newName);
    }
  }, [content, entry.id, entry.name, onEdit]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -5 }}
      className="group relative"
    >
      <motion.div
        layout
        className={`
          ${styles.knowledgeBase.bubble}
          cursor-pointer
          group
        `}
      >
        <div className="relative">
          {/* Title section */}
          <div
            className="flex items-center justify-between gap-2 mb-2"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <div className="flex items-center gap-2">
              <motion.div
                animate={{ rotate: isExpanded ? 90 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <ChevronRight size={12} className="text-gray-400 group-hover:text-cyan-400" />
              </motion.div>
              <span className="font-satoshi text-[12px] text-gray-300 group-hover:text-cyan-400/90 transition-colors duration-300">
                {entry.name || 'New Entry'}
              </span>
            </div>

            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={(e) => {
                e.stopPropagation();
                onRemove(entry.id);
              }}
              className="p-1.5 rounded-md hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all duration-300 z-50"
            >
              <X size={11} className="text-gray-400 hover:text-red-400" />
            </motion.button>
          </div>

          {/* Content section */}
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="relative"
              >
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  onBlur={() => {
                    if (content.trim() !== entry.content) {
                      onEdit(entry.id, content);
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className={`
                    ${styles.knowledgeBase.content}
                    min-h-[100px]
                    resize-none
                    transition-all duration-300
                    focus:ring-1 focus:ring-cyan-500/50 
                    focus:border-cyan-500/30
                    hover:border-cyan-500/20
                    placeholder:text-gray-600/50
                  `}
                  placeholder="Enter knowledge content..."
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
};

// Add this new component at the top with other imports
const TranscriptTimeline = ({ transcript, currentTime, onTimeClick }: {
  transcript: any;
  currentTime: number;
  onTimeClick: (time: number) => void;
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  // Reset scroll position to start when transcript changes
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft = 0;
    }
  }, [transcript]);

  // Auto-scroll to active word with a threshold
  useEffect(() => {
    if (!transcript?.content?.segments || !scrollContainerRef.current || isDragging) return;

    const activeSegment = transcript.content.segments.find((segment: any) =>
      currentTime >= segment.start && currentTime <= segment.end
    );

    if (activeSegment) {
      const segmentElement = document.getElementById(`segment-${activeSegment.start}`);
      if (segmentElement) {
        const container = scrollContainerRef.current;
        const containerWidth = container.offsetWidth;
        const segmentLeft = segmentElement.offsetLeft;
        const segmentWidth = segmentElement.offsetWidth;

        // Only scroll if the active segment is not fully visible
        const isVisible = (
          segmentLeft >= container.scrollLeft &&
          segmentLeft + segmentWidth <= container.scrollLeft + containerWidth
        );

        if (!isVisible) {
          const scrollPosition = segmentLeft - containerWidth / 3;
          container.scrollTo({
            left: scrollPosition,
            behavior: 'smooth'
          });
        }
      }
    }
  }, [currentTime, transcript, isDragging]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setStartX(e.pageX - scrollContainerRef.current!.offsetLeft);
    setScrollLeft(scrollContainerRef.current!.scrollLeft);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    const x = e.pageX - scrollContainerRef.current!.offsetLeft;
    const walk = (x - startX) * 2;
    scrollContainerRef.current!.scrollLeft = scrollLeft - walk;
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  return (
    <div className="relative w-full h-full bg-black/40 flex flex-col">
      {/* Timeline ruler */}
      <div className="h-4 border-b border-gray-800 flex items-end px-2">
        <div className="flex-1 flex items-center">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex-1 flex items-center justify-between">
              <div className="h-2 w-px bg-gray-800" />
              <div className="h-1.5 w-px bg-gray-800" />
              <div className="h-1.5 w-px bg-gray-800" />
              <div className="h-1.5 w-px bg-gray-800" />
            </div>
          ))}
        </div>
      </div>

      {/* Transcript content */}
      <div
        ref={scrollContainerRef}
        className={`
          flex-1 overflow-x-auto whitespace-nowrap
          scrollbar-thin scrollbar-track-transparent scrollbar-thumb-gray-700/30
          hover:scrollbar-thumb-cyan-500/20
          cursor-grab ${isDragging ? 'cursor-grabbing' : ''}
          relative
        `}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div className="min-w-full px-4 py-3 flex items-start h-full">
          <div className="flex flex-wrap gap-1">
            {transcript?.content?.segments?.map((segment: any, index: number) => (
              <motion.span
                key={segment.start}
                id={`segment-${segment.start}`}
                onClick={() => onTimeClick(segment.start)}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className={`
                  inline-block px-2 py-1 rounded
                  transition-all duration-150 text-[13px] leading-relaxed
                  ${currentTime >= segment.start && currentTime <= segment.end
                    ? 'bg-cyan-500/20 text-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                    : 'text-gray-400 hover:text-gray-300 hover:bg-cyan-500/10'
                  }
                  cursor-pointer
                  hover:scale-105
                  hover:shadow-[0_0_15px_rgba(34,211,238,0.1)]
                `}
              >
                {segment.text}
              </motion.span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// Replace the formatTimeWithDecimals function with this simpler version
const formatTime = (time: number): string => {
  if (!isFinite(time) || isNaN(time)) return '0:00';
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

// Update the VideoPlayer component with better mobile support
const VideoPlayer = ({
  videoRef,
  videoUrl,
  currentTime,
  setCurrentTime,
  setDuration,
  onTimeUpdate,
  isPlaying,
  setIsPlaying,
}: {
  videoRef: React.RefObject<HTMLVideoElement>;
  videoUrl: string | null;
  currentTime: number;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  onTimeUpdate: () => void;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const { isMobile } = useIsMobile();

  // Handle initial load and duration updates
  const handleLoadedMetadata = () => {
    if (!videoRef.current) return;
    const dur = videoRef.current.duration;
    if (dur && !isNaN(dur) && isFinite(dur)) {
      setDuration(dur);
      // Don't set loading false here, wait for canplay
      if (isMobile) {
        videoRef.current.muted = true;
      }
    }
  };

  // Handle when video can actually play
  const handleCanPlay = () => {
    setIsVideoReady(true);
    setIsLoading(false); // Move loading state here

    // Auto-play on mobile if muted
    if (isMobile && videoRef.current?.muted && !hasInteracted) {
      attemptPlay();
    }
  };

  // Enhanced error handling
  const handlePlaybackError = (error: any) => {
    console.error('Video playback error:', error);
    if (isVideoReady) {
      setPlaybackError('Unable to play video. Please try again.');
    }
    setIsPlaying(false);
    setIsLoading(false);
  };

  // Handle play attempt with mobile considerations
  const attemptPlay = async () => {
    if (!videoRef.current || !isVideoReady) return;

    try {
      setPlaybackError(null);

      // Don't set loading true here anymore
      // setIsLoading(true);

      // For mobile, ensure video is muted for first play
      if (isMobile && !hasInteracted) {
        videoRef.current.muted = true;
      }

      await videoRef.current.play();
      setIsPlaying(true);
      setHasInteracted(true);
    } catch (error) {
      handlePlaybackError(error);
    }
  };

  // Handle click/tap with mobile considerations
  const handleVideoClick = async () => {
    if (!videoRef.current || !isVideoReady) return;

    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      // If on mobile and first interaction, unmute
      if (isMobile && hasInteracted && videoRef.current.muted) {
        videoRef.current.muted = false;
      }
      attemptPlay();
    }
  };

  // Reset states when video URL changes
  useEffect(() => {
    if (videoUrl) {
      setIsVideoReady(false);
      setIsLoading(true);
      setPlaybackError(null);
      setHasInteracted(false);
      if (videoRef.current) {
        videoRef.current.load();
      }
    }
  }, [videoUrl]);

  // Add this effect to handle video URL changes and loading
  useEffect(() => {
    if (!videoUrl) {
      setIsLoading(true);
      setIsVideoReady(false);
      return;
    }

    if (videoRef.current) {
      videoRef.current.src = videoUrl;
      videoRef.current.load(); // Force reload with new URL
    }
  }, [videoUrl]);

  return (
    <div className="relative w-full h-full bg-black" onClick={handleVideoClick}>
      {/* Only render video if we have a URL */}
      {videoUrl ? (
        <div className="w-full h-full flex items-center justify-center bg-black">
          <div className="h-full relative flex items-center justify-center">
            <video
              ref={videoRef}
              className="h-full w-auto max-w-none"
              style={{
                objectFit: 'contain'
              }}
              crossOrigin="anonymous"
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={onTimeUpdate}
              onError={(e) => handlePlaybackError(e)}
              onPlaying={() => {
                setIsLoading(false);
                setPlaybackError(null);
              }}
              onCanPlay={handleCanPlay}
              onWaiting={() => setIsLoading(true)}
              onStalled={() => setIsLoading(true)}
              playsInline
              webkit-playsinline="true"
              x-webkit-airplay="allow"
              preload="metadata"
              muted={isMobile && !hasInteracted}
              controls={false}
              autoPlay={false}
            >
              <source
                src={videoUrl}
                type={videoUrl?.endsWith('.webm') ? 'video/webm' : 'video/mp4'}
              />
            </video>
          </div>
        </div>
      ) : (
        // Show loading state if no video URL yet
        <div className="absolute inset-0 flex items-center justify-center bg-black">
          <div className="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-400 animate-spin rounded-full" />
        </div>
      )}

      {/* Play Button Overlay */}
      {isVideoReady && !isPlaying && !isLoading && !playbackError && (
        <div className="absolute inset-0 flex items-center justify-center bg-transparent z-20">
          <motion.div
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className="p-4 rounded-full bg-black/30 border border-cyan-500/50
              backdrop-blur-sm
              shadow-[0_0_15px_rgba(34,211,238,0.2)]"
          >
            <Play
              size={isMobile ? 24 : 32}
              className="text-cyan-400"
            />
          </motion.div>
        </div>
      )}

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-10">
          <div className="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-400 animate-spin rounded-full" />
        </div>
      )}

      {/* Error Overlay */}
      {playbackError && isVideoReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-10">
          <div className="text-red-400 text-sm text-center px-4">
            {playbackError}
            <button
              onClick={(e) => {
                e.stopPropagation();
                attemptPlay();
              }}
              className="mt-2 px-3 py-1 bg-cyan-500/20 text-cyan-400 rounded-md text-xs
                hover:bg-cyan-500/30 transition-all duration-300"
            >
              Try Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Add this new component for mobile video controls with better UX
const MobileVideoControls = ({
  isPlaying,
  currentTime,
  duration,
  isMuted,
  onPlayPause,
  onMuteToggle,
}: {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isMuted: boolean;
  onPlayPause: () => void;
  onMuteToggle: () => void;
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-3 z-30"
    >
      <div className="flex items-center gap-4">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={onPlayPause}
          className="text-white/90 hover:text-cyan-400 transition-colors"
        >
          {isPlaying ? <Pause size={20} /> : <Play size={20} />}
        </motion.button>

        <div className="flex-1 text-[11px] text-white/70 font-medium">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>

        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={onMuteToggle}
          className="text-white/90 hover:text-cyan-400 transition-colors"
        >
          {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
        </motion.button>
      </div>
    </motion.div>
  );
};

// Add the glow animation keyframes
const glowAnimation = keyframes`
  0% {
    filter: drop-shadow(0 0 2px #00f7ff);
  }
  50% {
    filter: drop-shadow(0 0 4px #00f7ff);
  }
  100% {
    filter: drop-shadow(0 0 2px #00f7ff);
  }
`;

const BrdgeLogo = styled.img`
  width: 24px;
  height: 24px;
  margin-right: 8px;
  animation: ${glowAnimation} 2s ease-in-out infinite;
`;

// Add this keyframe animation to your existing keyframes
const loadingAnimation = keyframes`
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
`;

// First, add a debounced save utility at the top of the file
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

// Add animation keyframe for tooltip auto-dismiss
const fadeOutAnimation = `
  @keyframes fadeOut {
    0%, 70% { opacity: 1; }
    100% { opacity: 0; }
  }

  .animate-fadeOut {
    animation: fadeOut 5s forwards;
  }
`;

// Add style tag to head
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = fadeOutAnimation;
  document.head.appendChild(style);
}

// Add animation keyframe for mic button glow
const animations = `
  @keyframes fadeOut {
    0%, 70% { opacity: 1; }
    100% { opacity: 0; }
  }

  @keyframes pulseGlow {
    0% { box-shadow: 0 0 5px rgba(34,211,238,0.3); }
    50% { box-shadow: 0 0 15px rgba(34,211,238,0.4); }
    100% { box-shadow: 0 0 5px rgba(34,211,238,0.3); }
  }

  .animate-fadeOut {
    animation: fadeOut 5s forwards;
  }

  .animate-glow {
    animation: pulseGlow 2s infinite;
    animation-duration: 5s;
    animation-iteration-count: 1;
  }
`;

// Add style tag to head
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = animations;
  document.head.appendChild(style);
}

export default function Playground({
  logo,
  themeColors,
  onConnect,
  agentType
}: PlaygroundProps) {
  const { isMobile, isLandscape } = useIsMobile();
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const [isCreatingVoice, setIsCreatingVoice] = useState(false);
  const [savedVoices, setSavedVoices] = useState<SavedVoice[]>([]);

  // Existing state
  const [params, setParams] = useState({
    brdgeId: null as string | null,
    apiBaseUrl: null as string | null,
    coreApiUrl: API_BASE_URL,
    userId: null as string | null,
    agentType: 'edit' as 'edit' | 'view'  // Add this line with default
  });

  // Video URL state and fetching
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const fetchVideoUrl = useCallback(async () => {
    if (!params.brdgeId || !params.apiBaseUrl) return;

    try {
      const response = await fetch(`${params.apiBaseUrl}/brdges/${params.brdgeId}/recordings/latest/signed-url`);
      if (!response.ok) throw new Error('Failed to fetch video URL');

      const { url } = await response.json();
      setVideoUrl(url);
    } catch (error) {
      console.error('Error fetching video URL:', error);
    }
  }, [params.brdgeId, params.apiBaseUrl]);

  useEffect(() => {
    fetchVideoUrl();
  }, [fetchVideoUrl]);

  // Load saved voices on mount
  useEffect(() => {
    const loadVoices = async () => {
      if (!params.brdgeId) return;
      try {
        const response = await fetch(`${params.apiBaseUrl}/brdges/${params.brdgeId}/voices`);
        if (!response.ok) throw new Error('Failed to fetch voices');

        const data = await response.json();
        if (data.voices) {
          setSavedVoices(data.voices);
          // Auto-select first voice if available and none selected
          if (data.voices.length > 0 && !selectedVoice) {
            setSelectedVoice(data.voices[0].id);
          }
        }
      } catch (error) {
        console.error('Error loading voices:', error);
      }
    };

    loadVoices();
  }, [params.brdgeId, params.apiBaseUrl, selectedVoice]);

  // LiveKit related hooks
  const { localParticipant } = useLocalParticipant();
  const voiceAssistant = useVoiceAssistant();
  const roomState = useConnectionState();
  const [transcripts, setTranscripts] = useState<ChatMessageType[]>([]);
  const chat = useChat();

  // Get URL params
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const token = urlParams.get('token');
      const newParams = {
        brdgeId: urlParams.get('brdgeId'),
        apiBaseUrl: urlParams.get('apiBaseUrl'),
        coreApiUrl: API_BASE_URL,
        userId: token ?
          jwtDecode<JWTPayload>(token).sub :
          `anon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        agentType: (urlParams.get('agentType') as 'edit' | 'view') || 'edit'  // Add this line
      };
      setParams(newParams);
    }
  }, []);

  // Handle chat messages
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

  // Add these state variables at the top with other states
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [isLoadingTranscript, setIsLoadingTranscript] = useState(false);

  // Add this function to fetch the transcript
  const fetchTranscript = useCallback(async () => {
    if (!params.brdgeId || !params.apiBaseUrl) return;

    setIsLoadingTranscript(true);
    try {
      const response = await fetch(`${params.apiBaseUrl}/brdges/${params.brdgeId}/script`);
      if (!response.ok) throw new Error('Failed to fetch transcript');

      const data = await response.json();
      setTranscript(data);
    } catch (error) {
      console.error('Error fetching transcript:', error);
    } finally {
      setIsLoadingTranscript(false);
    }
  }, [params.brdgeId, params.apiBaseUrl]);

  // Add useEffect to fetch transcript when component mounts
  useEffect(() => {
    fetchTranscript();
  }, [fetchTranscript]);

  // Add state for video current time
  const [currentTime, setCurrentTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Add these state variables
  const [agentConfig, setAgentConfig] = useState<AgentConfig>({
    personality: "",
    agentPersonality: {
      name: "AI Assistant",
      expertise: [],
      knowledge_areas: [],
      persona_background: "A helpful AI assistant",
      response_templates: {
        greeting: null,
        not_sure: null,
        follow_up_questions: []
      },
      communication_style: "friendly",
      voice_characteristics: {
        pace: "measured",
        tone: "neutral",
        common_phrases: [],
        emphasis_patterns: ""
      }
    },
    knowledgeBase: [
      { id: "presentation", type: "presentation", name: "", content: "" }
    ]
  });

  // Update the useEffect that fetches agent config to handle the structured personality
  useEffect(() => {
    const fetchAgentConfig = async () => {
      if (!params.brdgeId || !params.apiBaseUrl) return;

      try {
        console.log('Fetching agent config...');
        const response = await fetch(`${params.apiBaseUrl}/brdges/${params.brdgeId}/agent-config`);

        if (!response.ok) throw new Error('Failed to fetch agent config');

        const data = await response.json();
        console.log('Received agent config:', data);

        // Ensure backwards compatibility - if script data exists, populate the agentPersonality field
        if (data.script && data.script.agent_personality) {
          data.agentPersonality = data.script.agent_personality;
        }

        setAgentConfig(data);
      } catch (error) {
        console.error('Error fetching agent config:', error);
      }
    };

    fetchAgentConfig();
  }, [params.brdgeId, params.apiBaseUrl]);

  // Add this function to handle config updates
  const updateAgentConfig = async (newConfig: typeof agentConfig) => {
    try {
      const response = await fetch(
        `${params.apiBaseUrl}/brdges/${params.brdgeId}/agent-config`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            personality: newConfig.personality,
            agentPersonality: newConfig.agentPersonality,
            knowledgeBase: newConfig.knowledgeBase,
            script: {
              agent_personality: newConfig.agentPersonality // Explicitly update script.agent_personality field
            }
          }),
        }
      );
      if (response.ok) {
        setAgentConfig(newConfig);
      }
    } catch (error) {
      console.error('Error updating agent config:', error);
    }
  };

  // Add this state for voice cloning
  const [isVoiceCloning, setIsVoiceCloning] = useState(false);
  const [voiceCloneProgress, setVoiceCloneProgress] = useState(0);

  // Add voice cloning function
  const cloneVoice = async (name: string) => {
    if (!params.brdgeId || !params.apiBaseUrl) return;

    try {
      setIsVoiceCloning(true);
      const response = await fetch(
        `${params.apiBaseUrl}/brdges/${params.brdgeId}/voices/clone`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        }
      );

      if (!response.ok) throw new Error('Failed to clone voice');

      // Refresh voice list
      const voicesResponse = await fetch(`${params.apiBaseUrl}/brdges/${params.brdgeId}/voices`);
      if (voicesResponse.ok) {
        const data = await voicesResponse.json();
        setSavedVoices(data.voices);
      }
    } catch (error) {
      console.error('Error cloning voice:', error);
    } finally {
      setIsVoiceCloning(false);
      setVoiceCloneProgress(0);
    }
  };

  // Add these state variables where other states are defined
  const [brdge, setBrdge] = useState<Brdge | null>(null);
  const [isLoadingBrdge, setIsLoadingBrdge] = useState(false);

  // Add this useEffect to fetch the brdge data
  useEffect(() => {
    const fetchBrdge = async () => {
      if (!params.brdgeId || !params.apiBaseUrl) {
        console.log('Missing params:', { brdgeId: params.brdgeId, apiBaseUrl: params.apiBaseUrl });
        return;
      }

      setIsLoadingBrdge(true);
      try {
        const url = `${params.apiBaseUrl}/brdges/${params.brdgeId}`;
        console.log('Fetching brdge from:', url);

        const response = await fetch(url);
        console.log('Response status:', response.status);

        if (!response.ok) throw new Error('Failed to fetch brdge');

        const data = await response.json();
        console.log('Fetched brdge data:', data);
        setBrdge(data);

        // Update agentConfig with the brdge's personality if it exists
        setAgentConfig(prev => ({
          ...prev,
          personality: data.agent_personality || "friendly ai assistant"
        }));

      } catch (error) {
        console.error('Error fetching brdge:', error);
      } finally {
        setIsLoadingBrdge(false);
      }
    };

    fetchBrdge();
  }, [params.brdgeId, params.apiBaseUrl]);

  useEffect(() => {
    console.log('Current params:', params);
  }, [params]);

  // Add this near your other state declarations
  const debouncedUpdateConfig = useDebounce((newConfig: AgentConfig) => {
    updateAgentConfig(newConfig);
  }, 500);

  // Update the handleKnowledgeEdit function to use debouncing
  const handleKnowledgeEdit = useCallback((id: string, content: string, name?: string) => {
    setAgentConfig(prev => {
      const newConfig = {
        ...prev,
        knowledgeBase: prev.knowledgeBase.map(entry =>
          entry.id === id
            ? { ...entry, content, ...(name && { name }) }
            : entry
        )
      };

      // Debounce the API call
      debouncedUpdateConfig(newConfig);

      return newConfig;
    });
  }, [debouncedUpdateConfig]);

  // Handler for removing knowledge entries
  const handleKnowledgeRemove = useCallback((id: string) => {
    setAgentConfig(prev => ({
      ...prev,
      knowledgeBase: prev.knowledgeBase.filter(entry => entry.id !== id)
    }));

    // Update the backend
    updateAgentConfig({
      ...agentConfig,
      knowledgeBase: agentConfig.knowledgeBase.filter(entry => entry.id !== id)
    });
  }, [agentConfig, updateAgentConfig]);

  // Add this inside the Playground component, with other state variables
  const [activeTab, setActiveTab] = useState<ConfigTab>(params.agentType === 'view' ? 'chat' : 'ai-agent');

  // Add an effect to update activeTab when params.agentType changes
  useEffect(() => {
    if (params.agentType === 'view') {
      setActiveTab('chat');
    }
  }, [params.agentType]);

  // Add these refs and states near the top of the component
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [currentRecording, setCurrentRecording] = useState<Blob | null>(null);
  const [voiceName, setVoiceName] = useState('');
  const [isCloning, setIsCloning] = useState(false);

  // Add these state variables in the main Playground component
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const progressBarRef = useRef<HTMLDivElement>(null);

  // Add these helper functions before the return statement
  const formatTime = (seconds: number) => {
    if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

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
    }
  };

  const handleCloneVoice = async () => {
    if (!currentRecording || !voiceName || !params.brdgeId) return;
    setIsCloning(true);
    try {
      const formData = new FormData();
      formData.append('audio', currentRecording);
      formData.append('name', voiceName);

      // Use fetch directly instead of the api object
      const response = await fetch(`${params.apiBaseUrl}/brdges/${params.brdgeId}/voice/clone`, {
        method: 'POST',
        body: formData,
        // Don't include credentials to avoid preflight issues
        credentials: 'omit',
        headers: {
          // Don't set Content-Type header for FormData, browser will set it with boundary
          // Include auth token if available
          ...(localStorage.getItem('token') ? {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          } : {})
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to clone voice: ${response.status} ${response.statusText}`);
      }

      const responseData = await response.json();
      console.log('Voice clone response:', responseData);

      // Refresh voice list
      const voicesResponse = await fetch(`${params.apiBaseUrl}/brdges/${params.brdgeId}/voices`);
      if (voicesResponse.ok) {
        const voicesData = await voicesResponse.json();
        if (voicesData.voices) {
          setSavedVoices(voicesData.voices);
          if (responseData.voice?.id) {
            setSelectedVoice(responseData.voice.id);
            setIsCreatingVoice(false);
          }
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

  // Add this useEffect to handle automatic voice activation
  useEffect(() => {
    if (!params.brdgeId || !params.apiBaseUrl) return;

    if (savedVoices.length === 1) {
      // If there's only one voice, make it active
      const voice = savedVoices[0];
      if (voice.status !== 'active') {
        fetch(`${params.apiBaseUrl}/brdges/${params.brdgeId}/voice/activate`, {
          method: 'POST',
          body: JSON.stringify({ voice_id: voice.id }),
          headers: {
            'Content-Type': 'application/json',
            ...(localStorage.getItem('token') ? {
              'Authorization': `Bearer ${localStorage.getItem('token')}`
            } : {})
          },
          credentials: 'omit'
        })
          .then(response => {
            if (response.ok) {
              setSavedVoices([{ ...voice, status: 'active' }]);
            }
          })
          .catch(error => console.error('Error activating single voice:', error));
      }
    } else if (savedVoices.length > 1 && !savedVoices.some(v => v.status === 'active')) {
      // If there are multiple voices and none are active, activate the most recent one
      const mostRecent = savedVoices.reduce((prev, current) => {
        return new Date(current.created_at) > new Date(prev.created_at) ? current : prev;
      }, savedVoices[0]);

      fetch(`${params.apiBaseUrl}/brdges/${params.brdgeId}/voice/activate`, {
        method: 'POST',
        body: JSON.stringify({ voice_id: mostRecent.id }),
        headers: {
          'Content-Type': 'application/json',
          ...(localStorage.getItem('token') ? {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          } : {})
        },
        credentials: 'omit'
      })
        .then(response => {
          if (response.ok) {
            setSavedVoices(prev => prev.map(v => ({
              ...v,
              status: v.id === mostRecent.id ? 'active' : 'inactive'
            })));
          }
        })
        .catch(error => console.error('Error activating most recent voice:', error));
    }
  }, [savedVoices, params.brdgeId, params.apiBaseUrl]);

  // Update tabs array
  const tabs = params.agentType === 'view' ? [
    { id: 'chat', label: 'Chat' }
  ] : [
    { id: 'ai-agent', label: 'AI Agent' },
    { id: 'voice-clone', label: 'Voice Clone' },
    { id: 'chat', label: 'Chat' }
  ];

  // Update the data channel usage
  const { send: sendData } = useDataChannel("agent_data_channel", (msg: DataChannelMessage) => {
    try {
      const data = JSON.parse(new TextDecoder().decode(msg.payload));
      console.log("Data Channel received:", data);
    } catch (error) {
      console.error("Error parsing data channel message:", error);
    }
  });

  // Update the computeTranscriptPosition function to better handle the segments
  const computeTranscriptPosition = useCallback((time: number) => {
    if (!transcript?.content?.segments) {
      console.log('No transcript segments available');
      return { read: [], remaining: [] };
    }

    try {
      // Filter segments into read and remaining based on current time
      const read = transcript.content.segments
        .filter(seg => seg.end <= time)
        .map(seg => seg.text.trim())
        .filter(text => text.length > 0); // Filter out empty segments

      const remaining = transcript.content.segments
        .filter(seg => seg.start > time)
        .map(seg => seg.text.trim())
        .filter(text => text.length > 0); // Filter out empty segments

      console.log('Computed transcript position:', {
        currentTime: time,
        readCount: read.length,
        remainingCount: remaining.length,
        read: read.slice(0, 3), // Log first 3 for debugging
        remaining: remaining.slice(0, 3) // Log first 3 for debugging
      });

      return { read, remaining };
    } catch (error) {
      console.error('Error computing transcript position:', error);
      return { read: [], remaining: [] };
    }
  }, [transcript]);

  // Update the effect that sends transcript position
  useEffect(() => {
    if (roomState === ConnectionState.Connected && transcript?.content?.segments) {
      try {
        const position = computeTranscriptPosition(currentTime);

        // Only send if we have actual segments
        if (position.read.length > 0 || position.remaining.length > 0) {
          const payload: DataChannelPayload = {
            transcript_position: position
          };

          console.log('Sending transcript position:', payload);
          sendData(new TextEncoder().encode(JSON.stringify(payload)), { topic: "agent_data_channel" });
        }
      } catch (error) {
        console.error('Error sending transcript position:', error);
      }
    }
  }, [currentTime, roomState, sendData, computeTranscriptPosition, transcript]);

  // Add this effect to log when transcript changes
  useEffect(() => {
    if (transcript?.content?.segments) {
      console.log('Transcript loaded:', {
        segmentCount: transcript.content.segments.length,
        firstSegment: transcript.content.segments[0],
        lastSegment: transcript.content.segments[transcript.content.segments.length - 1]
      });
    }
  }, [transcript]);

  // Add effect to send initial transcript position
  useEffect(() => {
    if (roomState === ConnectionState.Connected && transcript?.content?.segments) {
      const entireTranscript = transcript.content.segments
        .map(seg => seg.text.trim())
        .filter(Boolean);

      const payload: DataChannelPayload = {
        transcript_position: {
          read: [],
          remaining: entireTranscript
        }
      };

      console.log('Sending initial transcript position:', payload);
      sendData(new TextEncoder().encode(JSON.stringify(payload)), { topic: "agent_data_channel" });
    }
  }, [roomState, transcript, sendData]);

  // Update connect handler to use LiveKit connection
  const handleConnect = useCallback(async () => {
    if (roomState === ConnectionState.Connected) {
      onConnect(false);
    } else {
      // The parent component (index.tsx) handles the token and url
      // Just pass the connection request up
      onConnect(true);
    }
  }, [roomState, onConnect]);

  // Update the connect button to use the new handler
  const connectButton = (
    <button
      onClick={handleConnect}
      className={`p-1.5 rounded-lg transition-colors text-xs
        ${roomState === ConnectionState.Connected
          ? 'bg-red-500/20 text-red-400'
          : 'bg-cyan-500/20 text-cyan-400'
        }`}
    >
      {roomState === ConnectionState.Connected ? 'Disconnect' : 'Connect'}
    </button>
  );

  // Add this effect to handle video playback state
  useEffect(() => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.play().catch(error => {
          console.error('Error playing video:', error);
          setIsPlaying(false);
        });
      } else {
        videoRef.current.pause();
      }
    }
  }, [isPlaying]);

  // Add this effect to update duration when video is loaded
  useEffect(() => {
    if (videoRef.current && videoRef.current.duration) {
      setDuration(videoRef.current.duration);
    }
  }, [videoUrl]);

  // Replace the progress bar click handler with this enhanced version
  const handleProgressBarInteraction = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!progressBarRef.current || !videoRef.current || !videoRef.current.duration) return;

    const rect = progressBarRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const newTime = percentage * videoRef.current.duration;

    if (isFinite(newTime) && !isNaN(newTime)) {
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  }, [setCurrentTime]); // Add setCurrentTime as a dependency

  // Add these state variables for progress bar dragging
  const [isDragging, setIsDragging] = useState(false);

  // Add these handlers for progress bar dragging
  const handleProgressBarMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    handleProgressBarInteraction(e);
  };

  const handleProgressBarMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      handleProgressBarInteraction(e);
    }
  };

  const handleProgressBarMouseUp = () => {
    setIsDragging(false);
  };

  // Add this state near other state declarations
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Update the save button click handler
  const handleSaveConfig = async () => {
    setIsSaving(true);
    try {
      // Update the agent config in the backend
      await updateAgentConfig(agentConfig);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (error) {
      console.error('Failed to save agent config:', error);
      // Use an alert instead of toast
      alert('Failed to save configuration. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Add this ref for the file input
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Add this state for upload status
  const [isUploading, setIsUploading] = useState(false);

  // Update the handlePresentationUpload function
  const handlePresentationUpload = async (file: File) => {
    if (!params.brdgeId || !params.apiBaseUrl) return;

    setIsUploading(true);
    try {
      // Create FormData
      const formData = new FormData();
      formData.append('file', file);

      // Upload the file
      const response = await fetch(`${params.apiBaseUrl}/brdges/${params.brdgeId}/upload/presentation`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) throw new Error('Failed to upload file');

      const data = await response.json();

      // Update the brdge state with the new filename
      setBrdge(prev => prev ? {
        ...prev,
        presentation_filename: data.filename || file.name
      } : null);

      // Update agent config if needed
      setAgentConfig(prev => ({
        ...prev,
        knowledgeBase: [
          ...prev.knowledgeBase.filter(k => k.type !== 'presentation'),
          {
            id: `presentation_${Date.now()}`,
            type: 'presentation',
            name: file.name,
            content: ''
          }
        ]
      }));

    } catch (error) {
      console.error('Error uploading file:', error);
      // You might want to show an error message to the user here
    } finally {
      setIsUploading(false);
    }
  };

  // Add auto-connect effect after URL params are loaded
  useEffect(() => {
    const canAutoConnect = params.userId && params.brdgeId;
    if (canAutoConnect && roomState === ConnectionState.Disconnected) {
      onConnect(true);
    }
  }, [params, roomState, onConnect]);

  // Add effect to default mic to off when connected
  useEffect(() => {
    if (roomState === ConnectionState.Connected && localParticipant) {
      localParticipant.setMicrophoneEnabled(false);
    }
  }, [roomState, localParticipant]);

  // Add effect to pause video when speaking or TTS is active
  useEffect(() => {
    if (!videoRef.current) return;

    const isMicOn = localParticipant?.isMicrophoneEnabled;
    const isTTSSpeaking = !!voiceAssistant?.audioTrack;

    if (isMicOn || isTTSSpeaking) {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  }, [localParticipant?.isMicrophoneEnabled, voiceAssistant?.audioTrack]);

  // First, update the mobile layout class to be simpler
  const mobileLayoutClass = isMobile ? 'flex flex-col' : '';

  // Add mobile-specific video controls that overlay the video
  const MobileVideoControls = () => {
    return (
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (videoRef.current) {
                if (isPlaying) {
                  videoRef.current.pause();
                } else {
                  videoRef.current.play();
                }
                setIsPlaying(!isPlaying);
              }
            }}
            className="text-white/90 hover:text-cyan-400 transition-colors"
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>

          <div className="flex-1 text-[11px] text-white/60 font-medium">
            {formatTime(currentTime)} / {formatTime(videoRef.current?.duration || 0)}
          </div>

          <button
            onClick={() => {
              if (videoRef.current) {
                videoRef.current.muted = !isMuted;
                setIsMuted(!isMuted);
              }
            }}
            className="text-white/90 hover:text-cyan-400 transition-colors"
          >
            {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        </div>
      </div>
    );
  };

  // Add a FAB component for quick mobile actions
  const MobileFAB = () => {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => {
            if (roomState === ConnectionState.Connected && localParticipant) {
              localParticipant.setMicrophoneEnabled(!localParticipant.isMicrophoneEnabled);
            }
          }}
          className={`
            w-12 h-12 rounded-full
            flex items-center justify-center
            ${localParticipant?.isMicrophoneEnabled
              ? 'bg-red-500/90 text-white'
              : 'bg-cyan-500/90 text-white'}
            shadow-lg backdrop-blur-sm
            border border-white/10
          `}
        >
          {localParticipant?.isMicrophoneEnabled
            ? <MicOff size={18} />
            : <Mic size={18} />}
        </motion.button>
      </div>
    );
  };

  // Add this effect to send agent config when connected
  useEffect(() => {
    if (roomState === ConnectionState.Connected && agentConfig) {
      try {
        const configPayload = {
          agent_config: agentConfig,
          user_id: params.userId,
          brdge_id: params.brdgeId
        };

        console.log('Sending agent config:', configPayload);
        sendData(new TextEncoder().encode(JSON.stringify(configPayload)), { topic: "agent_data_channel" });
      } catch (error) {
        console.error('Error sending agent config:', error);
      }
    }
  }, [roomState, agentConfig, params.userId, params.brdgeId, sendData]);

  // Then update the main container and content area for mobile
  const [isInfoVisible, setIsInfoVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsInfoVisible(false);
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-[#121212] relative overflow-hidden">
      {/* Hide header on mobile as before */}
      {!isMobile && (
        <div className="h-[20px] flex items-center px-4 relative">
          {logo}
          {/* Multi-layered border effect */}
          <div className="absolute bottom-0 left-0 right-0">
            {/* Primary glowing line */}
            <div className="absolute bottom-0 left-0 right-0 h-[1px] 
            bg-gradient-to-r from-transparent via-cyan-500/80 to-transparent 
            shadow-[0_0_10px_rgba(34,211,238,0.4)]
            animate-pulse"
            />

            {/* Secondary accent lines */}
            <div className="absolute bottom-[1px] left-1/4 right-1/4 h-[1px] 
            bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent
            shadow-[0_0_8px_rgba(34,211,238,0.3)]"
            />

            {/* Animated scanning effect */}
            <div className="absolute bottom-0 left-0 right-0 h-[1px] overflow-hidden">
              <div className="absolute inset-0 
              bg-gradient-to-r from-transparent via-cyan-300/60 to-transparent
              animate-[scan_4s_ease-in-out_infinite]
              w-1/2 translate-x-full"
              />
            </div>

            {/* Edge accents */}
            <div className="absolute bottom-0 left-0 w-8 h-[2px]
            bg-gradient-to-r from-cyan-400/80 to-transparent
            shadow-[0_0_10px_rgba(34,211,238,0.4)]"
            />
            <div className="absolute bottom-0 right-0 w-8 h-[2px]
            bg-gradient-to-l from-cyan-400/80 to-transparent
            shadow-[0_0_10px_rgba(34,211,238,0.4)]"
            />
          </div>
        </div>
      )}

      {/* Main container */}
      <div className={`flex-1 relative ${mobileLayoutClass}`}>
        {/* Main Content */}
        <div
          className={`
            ${!isMobile ? 'absolute inset-0' : 'w-full h-full flex flex-col'}
            ${!isMobile && !isRightPanelCollapsed ? 'right-[360px]' : 'right-0'}
            transition-all duration-300
          `}
        >
          <PanelGroup direction="vertical">
            {/* Video Panel - Adjust size for mobile */}
            <Panel
              defaultSize={isMobile ? 40 : 85}
              minSize={isMobile ? 30 : 60}
            >
              <div className="h-full w-full bg-black">
                <VideoPlayer
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
                />
              </div>
            </Panel>

            {/* Chat/Transcript Panel for Mobile */}
            {isMobile && (
              <Panel defaultSize={60} minSize={30}>
                <div className="h-full flex flex-col bg-black/90">
                  {/* Chat content */}
                  <div className="flex-1 overflow-y-auto">
                    {/* Voice Assistant Transcription */}
                    {voiceAssistant?.audioTrack && (
                      <div className="p-2">
                        <TranscriptionTile
                          agentAudioTrack={voiceAssistant.audioTrack}
                          accentColor="cyan"
                        />
                      </div>
                    )}

                    {/* Chat Messages */}
                    <div className="flex-1 p-2 space-y-1">
                      {transcripts.map((message) => (
                        <div
                          key={message.timestamp}
                          className={`
                            ${message.isSelf ? 'ml-auto bg-cyan-950/30' : 'mr-auto bg-gray-800/30'} 
                            max-w-[95%]
                            rounded-lg p-1.5
                            backdrop-blur-sm
                            border border-gray-700/50
                            transition-all duration-300
                            hover:border-cyan-500/30
                            group
                          `}
                        >
                          <div className="text-[11px] leading-relaxed text-gray-300">
                            {message.message}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </Panel>
            )}

            {/* Desktop Transcript Panel */}
            {!isMobile && (
              <>
                <PanelResizeHandle className={resizeHandleStyles.horizontal}>
                  <div className="relative w-full h-2 group">
                    <div className="absolute left-1/2 -translate-x-1/2 w-8 h-0.5 
                      bg-gradient-to-r from-transparent via-cyan-500/40 to-transparent 
                      group-hover:via-cyan-400
                      shadow-[0_0_8px_rgba(34,211,238,0.3)]
                      transition-all duration-300"
                    />
                    <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-[1px] overflow-hidden opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <div className="absolute inset-0 w-1/3
                        bg-gradient-to-r from-transparent via-cyan-300/40 to-transparent
                        animate-[scan_3s_ease-in-out_infinite]"
                      />
                    </div>
                  </div>
                </PanelResizeHandle>

                <Panel defaultSize={15} minSize={15} maxSize={40}>
                  <div className="h-full flex flex-col bg-black/90">
                    {/* Unified Control Bar with improved controls */}
                    <div className="border-b border-gray-800 bg-black/90 p-2 relative">
                      <div className="flex items-center gap-4">
                        {/* Play/Pause Button */}
                        <button
                          onClick={() => {
                            if (videoRef.current) {
                              if (isPlaying) {
                                videoRef.current.pause();
                              } else {
                                videoRef.current.play();
                              }
                              setIsPlaying(!isPlaying);
                            }
                          }}
                          className="text-white hover:text-cyan-400 transition-colors"
                        >
                          {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                        </button>

                        {/* Progress Bar Container */}
                        <div className="flex-1 relative">
                          {/* Outer bar (full width) */}
                          <div
                            ref={progressBarRef}
                            className="h-3 bg-gray-800/50 rounded-full cursor-pointer 
                              transition-colors duration-300
                              hover:bg-gray-700/60"
                            onMouseDown={(e) => {
                              setIsDragging(true);
                              handleProgressBarInteraction(e);
                            }}
                            onMouseMove={(e) => {
                              if (isDragging) handleProgressBarInteraction(e);
                            }}
                            onMouseUp={() => setIsDragging(false)}
                            onMouseLeave={() => setIsDragging(false)}
                          >
                            {/* Filled progress */}
                            <div
                              className="h-full bg-cyan-500 rounded-full transition-all duration-150"
                              style={{
                                width: duration > 0
                                  ? `${(currentTime / duration) * 100}%`
                                  : '0%',
                              }}
                            />
                            {/* Draggable Thumb - Modified for better hover behavior */}
                            {duration > 0 && (
                              <div
                                className="absolute top-1/2 -translate-y-1/2 
                                  w-3 h-3 bg-cyan-400 rounded-full
                                  shadow-[0_0_5px_rgba(34,211,238,0.6)]
                                  border-2 border-white/20
                                  transition-all duration-200
                                  opacity-0 hover:opacity-100
                                  hover:scale-125"
                                style={{
                                  left: `${(currentTime / duration) * 100}%`,
                                  opacity: isDragging ? 1 : undefined,
                                  transform: isDragging ? 'translate(-50%, -50%) scale(1.25)' : 'translate(-50%, -50%)',
                                }}
                              />
                            )}
                          </div>
                        </div>

                        {/* Time Display */}
                        <div className="flex items-center gap-2 text-[11px] text-gray-400 font-medium tracking-wider">
                          {formatTime(currentTime)} / {formatTime(duration)}
                        </div>

                        {/* Volume Control */}
                        <div className="flex items-center gap-2 group relative">
                          <button
                            onClick={() => {
                              if (videoRef.current) {
                                videoRef.current.muted = !isMuted;
                                setIsMuted(!isMuted);
                              }
                            }}
                            className="text-white hover:text-cyan-400 transition-colors"
                          >
                            {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                          </button>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            value={isMuted ? 0 : volume}
                            onChange={(e) => {
                              const newVolume = parseFloat(e.target.value);
                              setVolume(newVolume);
                              if (videoRef.current) {
                                videoRef.current.volume = newVolume;
                              }
                            }}
                            className="w-0 group-hover:w-20 transition-all duration-300 accent-cyan-500"
                          />
                        </div>

                        {/* Fullscreen Button */}
                        <button
                          onClick={() => {
                            if (videoRef.current) {
                              videoRef.current.requestFullscreen();
                            }
                          }}
                          className="text-white hover:text-cyan-400 transition-colors"
                        >
                          <Maximize2 size={18} />
                        </button>
                      </div>
                    </div>

                    {/* Empty space where transcript used to be */}
                    <div className="flex-1 bg-black/90" />
                  </div>
                </Panel>
              </>
            )}
          </PanelGroup>
        </div>

        {/* Right Panel - Desktop only */}
        {!isMobile && (
          <motion.div
            className={`
              ${isMobile && isLandscape
                ? 'w-[10%] h-[100dvh] border-l border-gray-800 touch-none'
                : 'absolute right-0 top-0 bottom-0 w-[360px] border-l border-gray-800'}
              bg-gray-900/50 backdrop-blur-md
              z-30
              transition-transform duration-300 ease-in-out
              before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[1px]
              before:bg-gradient-to-b before:from-transparent before:via-cyan-500/30 before:to-transparent
              before:shadow-[0_0_10px_rgba(34,211,238,0.2)]
              ${isMobile ? 'overflow-hidden' : ''}
            `}
            initial={false}
            animate={{
              transform: (!isMobile && isRightPanelCollapsed) ? 'translateX(360px)' : 'translateX(0)'
            }}
          >
            {/* Hide collapse button on mobile */}
            {!isMobile && (
              <button
                onClick={() => setIsRightPanelCollapsed(!isRightPanelCollapsed)}
                className="absolute -left-8 top-1/2 transform -translate-y-1/2
                w-8 h-16 bg-gray-900/80 backdrop-blur-sm
                rounded-l-lg flex items-center justify-center
                text-gray-400 transition-all duration-300
                border-y border-l border-gray-800/50
                hover:border-cyan-500/30 hover:text-cyan-400
                hover:shadow-[0_0_15px_rgba(0,255,255,0.1)]
                group
              "
              >
                <motion.div
                  animate={{ rotate: isRightPanelCollapsed ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </motion.div>
              </button>
            )}

            {/* Panel Content - Force chat tab on mobile */}
            <div className={`
              ${isMobile ? 'h-[100dvh] touch-none' : 'h-full'} 
              pl-4 pr-0 overflow-hidden
              ${isMobile ? 'pl-2' : ''}
            `}>
              <div className="h-full flex flex-col">
                {/* Only show tabs on desktop */}
                {!isMobile && (
                  <div className="flex items-center px-2 border-b border-gray-800/50 relative">
                    {/* Add glowing border effect */}
                    <div className="absolute bottom-0 left-0 right-0">
                      <div className="absolute bottom-0 left-0 right-0 h-[1px]
                      bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent
                      shadow-[0_0_8px_rgba(34,211,238,0.2)]"
                      />
                    </div>
                    {tabs.map((tab) => (
                      <motion.button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as ConfigTab)}
                        className={`
                        ${styles.tab.base}
                        ${activeTab === tab.id ? styles.tab.active : styles.tab.inactive}
                      `}
                      >
                        {tab.label}
                        {activeTab === tab.id && (
                          <motion.div
                            layoutId="activeTab"
                            className="
                            absolute bottom-0 left-0 right-0 h-[2px]
                            bg-gradient-to-r from-cyan-500 via-cyan-400 to-cyan-500/50
                            shadow-[0_0_10px_rgba(34,211,238,0.3)]
                          "
                            initial={false}
                            transition={{
                              type: "spring",
                              stiffness: 500,
                              damping: 30
                            }}
                          />
                        )}
                      </motion.button>
                    ))}
                  </div>
                )}

                {/* Tab Content - Always show chat on mobile */}
                <div className={`
                  flex-1 
                  ${isMobile ? 'overflow-hidden p-1' : 'overflow-y-auto p-3'} 
                  space-y-4
                  relative
                `}>
                  {/* Info Tooltip */}
                  <div className={`
                    absolute top-12 left-1/2 -translate-x-1/2 z-20
                    transition-all duration-500
                    ${(isMobile || activeTab === 'chat') && isInfoVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'}
                  `}>
                    <div className={`
                      relative px-3 py-2
                      bg-cyan-950/30 backdrop-blur-sm
                      border border-cyan-500/20
                      rounded-lg shadow-lg
                      text-[11px] text-cyan-300/90
                      shadow-[0_0_15px_rgba(34,211,238,0.1)]
                    `}>
                      <button
                        onClick={() => setIsInfoVisible(false)}
                        className="absolute -top-1 -right-1 p-0.5 rounded-full bg-cyan-950/50 text-cyan-400/70 hover:text-cyan-400"
                      >
                        <X size={10} />
                      </button>
                      Click the mic button to speak or type your message below
                    </div>
                  </div>

                  {/* Chat component - Always mounted but conditionally hidden */}
                  <div className={`
                    absolute inset-0
                    ${(isMobile || activeTab === 'chat') ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
                    transition-opacity duration-300
                  `}>
                    <div className="h-full flex flex-col">
                      {/* Sticky header - Simplified for mobile */}
                      <div className="sticky top-0 z-10 bg-[#121212]/95 backdrop-blur-sm border-b border-gray-800">
                        <div className={`flex items-center justify-between ${isMobile ? 'p-1' : 'p-2'}`}>
                          {/* Brand icon - Hide text on mobile */}
                          <div className="flex items-center gap-2">
                            <BrdgeLogo src="/new-img.png" alt="Brdge AI Logo" />
                            {!isMobile && <span className="text-sm text-gray-200 font-medium">AI Chat</span>}
                          </div>

                          {/* Info tooltip and Mic controls */}
                          <div className="flex items-center gap-2">
                            <div className="relative group">
                              <button
                                className="p-1.5 rounded-lg transition-all duration-300
                                text-cyan-400/70 hover:text-cyan-400
                                hover:bg-cyan-500/10"
                              >
                                <Info size={isMobile ? 12 : 14} />
                              </button>
                              <div className="absolute right-0 top-full mt-2 w-64 opacity-0 group-hover:opacity-100
                                pointer-events-none group-hover:pointer-events-auto
                                transition-all duration-300 transform translate-y-1 group-hover:translate-y-0">
                                <div className="bg-gray-900/95 backdrop-blur-sm rounded-lg p-3 shadow-xl
                                  border border-cyan-500/20 text-[11px] leading-relaxed text-cyan-300/90">
                                  <div className="font-medium mb-1 text-cyan-400">Welcome to Brdge AI!</div>
                                  Watch the video while interacting with our AI voice assistant.
                                  Toggle your mic to speak or type messages to engage in real-time conversation.
                                  <div className="mt-1 text-[10px] text-cyan-400/70">
                                    Pro tip: Ensure your environment is quiet and free of background noise.
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Mic toggle button - Simplified for mobile */}
                            <button
                              onClick={() => {
                                if (roomState === ConnectionState.Connected && localParticipant) {
                                  localParticipant.setMicrophoneEnabled(!localParticipant.isMicrophoneEnabled);
                                }
                              }}
                              disabled={roomState !== ConnectionState.Connected}
                              className={`
                                ${isMobile ? 'p-1' : 'p-1.5'}
                                rounded-lg transition-all duration-300
                                flex items-center gap-1.5
                                bg-cyan-500/20 text-cyan-400
                                hover:bg-cyan-500/30 hover:shadow-[0_0_10px_rgba(34,211,238,0.15)]
                                disabled:opacity-50 disabled:cursor-not-allowed
                                ${isInfoVisible ? 'animate-glow' : ''}
                              `}
                            >
                              {localParticipant?.isMicrophoneEnabled ?
                                <Mic size={isMobile ? 10 : 14} /> :
                                <MicOff size={isMobile ? 10 : 14} />
                              }
                              {!isMobile && (
                                <span className="text-[11px] font-medium">
                                  {localParticipant?.isMicrophoneEnabled ? 'Mic: On' : 'Mic: Off'}
                                </span>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Scrollable chat content */}
                      <div className={`
                        flex-1 
                        ${isMobile ? 'overflow-hidden' : 'overflow-y-auto'}
                        ${isMobile ? 'touch-none' : ''}
                      `}>
                        {/* Voice Assistant Transcription */}
                        {voiceAssistant?.audioTrack && (
                          <div className={`${isMobile ? 'p-1' : 'p-2'}`}>
                            <TranscriptionTile
                              agentAudioTrack={voiceAssistant.audioTrack}
                              accentColor="cyan"
                            />
                          </div>
                        )}

                        {/* Chat Messages */}
                        <div className={`flex-1 ${isMobile ? 'p-1' : 'p-2'} space-y-1`}>
                          {transcripts.map((message) => (
                            <div
                              key={message.timestamp}
                              className={`
                                ${message.isSelf ? 'ml-auto bg-cyan-950/30' : 'mr-auto bg-gray-800/30'} 
                                ${isMobile ? 'max-w-[95%]' : 'max-w-[85%]'}
                                rounded-lg p-1.5
                                backdrop-blur-sm
                                border border-gray-700/50
                                transition-all duration-300
                                hover:border-cyan-500/30
                                group
                              `}
                            >
                              <div className={`
                                ${isMobile ? 'text-[9px]' : 'text-[11px]'}
                                leading-relaxed
                                ${message.isSelf ? 'text-cyan-300' : 'text-gray-300'}
                                group-hover:text-cyan-400/90
                                transition-colors duration-300
                              `}>
                                {message.message}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Only render AI Agent and Voice Clone tabs in edit mode */}
                  {!isMobile && params.agentType !== 'view' && (
                    <>
                      {activeTab === 'ai-agent' && (
                        <div className={`
                          h-full
                          ${activeTab === 'ai-agent' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
                          transition-opacity duration-300
                        `}>
                          <div className="flex items-center justify-between mb-4">
                            <h2 className={styles.section.title}>AI Agent Configuration</h2>
                            <motion.button
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={handleSaveConfig}
                              disabled={isSaving}
                              className={`
                                group flex items-center gap-1.5
                                px-3 py-1.5 rounded-lg
                                bg-gradient-to-r 
                                ${saveSuccess
                                  ? 'from-green-500/20 to-green-400/10 border-green-500/30'
                                  : 'from-cyan-500/10 to-transparent border-cyan-500/20'
                                }
                                ${isSaving ? 'opacity-70 cursor-wait' : ''}
                                text-cyan-400 border
                                transition-all duration-300
                                hover:border-cyan-500/40
                                hover:shadow-[0_0_15px_rgba(34,211,238,0.1)]
                                disabled:opacity-50 disabled:cursor-not-allowed
                              `}
                            >
                              {isSaving ? (
                                <>
                                  <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                  <span className="text-[11px]">Saving...</span>
                                </>
                              ) : saveSuccess ? (
                                <>
                                  <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    className="text-green-400"
                                  >
                                    <svg
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      className="w-3 h-3"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M5 13l4 4L19 7"
                                      />
                                    </svg>
                                  </motion.div>
                                  <span className="text-[11px] text-green-400">Saved!</span>
                                </>
                              ) : (
                                <>
                                  <Save size={12} className="group-hover:rotate-12 transition-transform duration-300" />
                                  <span className="text-[11px]">Save Changes</span>
                                </>
                              )}
                            </motion.button>
                          </div>

                          {/* Agent Personality Section with improved spacing */}
                          <section className={`${styles.section.wrapper} mb-6`}>
                            <div className="flex items-center justify-between mb-6">
                              <h2 className={styles.section.title}>Agent Personality</h2>
                              <div className="h-[1px] flex-1 mx-4 bg-gradient-to-r from-transparent via-gray-700/50 to-transparent" />
                            </div>

                            {/* Editable Name with improved spacing */}
                            <div className="mb-8 relative z-[60]">
                              <label className={`${styles.label} block mb-2 text-cyan-400/70`}>Agent Name</label>
                              <input
                                type="text"
                                value={agentConfig.agentPersonality?.name || ''}
                                onChange={(e) => {
                                  setAgentConfig(prev => {
                                    const currentPersonality = prev.agentPersonality || {
                                      name: '',
                                      expertise: [],
                                      knowledge_areas: [],
                                      persona_background: 'A helpful AI assistant',
                                      response_templates: {
                                        greeting: 'Hello! How can I help you today?',
                                        not_sure: 'I\'m not sure about that, but I\'d be happy to help with what I know.',
                                        follow_up_questions: []
                                      },
                                      communication_style: 'friendly',
                                      voice_characteristics: {
                                        pace: 'measured',
                                        tone: 'neutral',
                                        common_phrases: [],
                                        emphasis_patterns: ''
                                      }
                                    };

                                    return {
                                      ...prev,
                                      agentPersonality: {
                                        ...currentPersonality,
                                        name: e.target.value
                                      }
                                    };
                                  });
                                }}
                                className={`
                                  ${styles.input.base}
                                  h-12
                                  text-[15px]
                                  focus:ring-1 focus:ring-cyan-500/50 
                                  focus:border-cyan-500/30
                                  hover:border-cyan-500/20
                                  placeholder:text-gray-600/50
                                  relative z-[60]
                                  bg-[#1E1E1E]/80
                                `}
                                placeholder="Enter agent name..."
                              />
                            </div>

                            {/* Editable Persona Background with improved spacing */}
                            <div className="mb-8 relative z-[50]">
                              <label className={`${styles.label} block mb-2 text-cyan-400/70`}>Persona Background</label>
                              <textarea
                                value={agentConfig.agentPersonality?.persona_background || ''}
                                onChange={(e) => {
                                  setAgentConfig(prev => {
                                    const currentPersonality = prev.agentPersonality || {
                                      name: 'AI Assistant',
                                      expertise: [],
                                      knowledge_areas: [],
                                      persona_background: '',
                                      response_templates: {
                                        greeting: 'Hello! How can I help you today?',
                                        not_sure: 'I\'m not sure about that, but I\'d be happy to help with what I know.',
                                        follow_up_questions: []
                                      },
                                      communication_style: 'friendly',
                                      voice_characteristics: {
                                        pace: 'measured',
                                        tone: 'neutral',
                                        common_phrases: [],
                                        emphasis_patterns: ''
                                      }
                                    };

                                    return {
                                      ...prev,
                                      agentPersonality: {
                                        ...currentPersonality,
                                        persona_background: e.target.value
                                      }
                                    };
                                  });
                                }}
                                className={`
                                  ${styles.input.base} ${styles.input.textarea}
                                  min-h-[160px]
                                  text-[15px]
                                  leading-relaxed
                                  focus:ring-1 focus:ring-cyan-500/50 
                                  focus:border-cyan-500/30
                                  hover:border-cyan-500/20
                                  placeholder:text-gray-600/50
                                  relative z-[50]
                                  bg-[#1E1E1E]/80
                                  resize-none
                                `}
                                placeholder="Describe the agent's background, expertise, and personality..."
                              />
                            </div>

                            {/* Editable Communication Style with improved spacing */}
                            <div className="mb-6 relative z-[40]">
                              <label className={`${styles.label} block mb-2 text-cyan-400/70`}>Communication Style</label>
                              <input
                                type="text"
                                value={agentConfig.agentPersonality?.communication_style || ''}
                                onChange={(e) => {
                                  setAgentConfig(prev => {
                                    const currentPersonality = prev.agentPersonality || {
                                      name: 'AI Assistant',
                                      expertise: [],
                                      knowledge_areas: [],
                                      persona_background: 'A helpful AI assistant',
                                      response_templates: {
                                        greeting: 'Hello! How can I help you today?',
                                        not_sure: 'I\'m not sure about that, but I\'d be happy to help with what I know.',
                                        follow_up_questions: []
                                      },
                                      communication_style: '',
                                      voice_characteristics: {
                                        pace: 'measured',
                                        tone: 'neutral',
                                        common_phrases: [],
                                        emphasis_patterns: ''
                                      }
                                    };

                                    return {
                                      ...prev,
                                      agentPersonality: {
                                        ...currentPersonality,
                                        communication_style: e.target.value
                                      }
                                    };
                                  });
                                }}
                                className={`
                                  ${styles.input.base}
                                  h-12
                                  text-[15px]
                                  focus:ring-1 focus:ring-cyan-500/50 
                                  focus:border-cyan-500/30
                                  hover:border-cyan-500/20
                                  placeholder:text-gray-600/50
                                  relative z-[40]
                                  bg-[#1E1E1E]/80
                                `}
                                placeholder="friendly, professional, technical, casual, etc."
                              />
                            </div>
                          </section>

                          {/* Document Knowledge Section with improved spacing */}
                          <section className={`${styles.section.wrapper} mt-2`}>
                            <div className="flex items-center justify-between mb-4">
                              <h2 className={styles.section.title}>Document Knowledge</h2>
                              <div className="h-[1px] flex-1 mx-4 bg-gradient-to-r from-transparent via-gray-700/50 to-transparent" />
                            </div>
                            <motion.div
                              layout
                              className="relative group bg-[#1E1E1E]/80 backdrop-blur-sm border border-gray-800/50 rounded-lg p-4 transition-all duration-300 hover:border-cyan-500/30 hover:shadow-[0_0_20px_rgba(34,211,238,0.07)]"
                            >
                              {/* Background gradient effect */}
                              <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/[0.02] to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 pointer-events-none" />

                              <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="p-2 rounded-md bg-cyan-500/10 border border-cyan-500/20">
                                    <FileText size={14} className="text-cyan-400 group-hover:animate-pulse shrink-0" />
                                  </div>
                                  <span className="text-[13px] text-gray-300 group-hover:text-cyan-400/90 transition-colors duration-300 truncate">
                                    {brdge?.presentation_filename ||
                                      agentConfig.knowledgeBase.find((k) => k.type === 'presentation')?.name ||
                                      "No document uploaded"}
                                  </span>
                                </div>
                              </div>
                            </motion.div>
                          </section>
                        </div>
                      )}
                      {activeTab === 'voice-clone' && (
                        <div className={`
                          h-full
                          ${activeTab === 'voice-clone' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
                          transition-opacity duration-300
                        `}>
                          <div className="flex items-center justify-between mb-4">
                            <h2 className={styles.section.title}>Voice Configuration</h2>
                            <motion.button
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={() => {
                                setSelectedVoice(null);
                                setIsCreatingVoice(true);
                              }}
                              className={`
                                group flex items-center gap-1.5
                                px-3 py-1.5 rounded-lg
                                bg-gradient-to-r from-cyan-500/10 to-transparent
                                text-cyan-400 border border-cyan-500/20
                                  transition-all duration-300
                                hover:border-cyan-500/40
                                hover:shadow-[0_0_15px_rgba(34,211,238,0.1)]
                              `}
                            >
                              <Plus size={12} className="group-hover:rotate-90 transition-transform duration-300" />
                              <span className="text-[11px]">Create New Voice</span>
                            </motion.button>
                          </div>

                          {(!savedVoices.length || isCreatingVoice) ? (
                            // Voice Creation Section
                            <div className="space-y-4">
                              {/* Voice Setup Section */}
                              <section className={styles.section.wrapper}>
                                <h2 className={styles.section.title}>Voice Setup</h2>
                                <div className="
                                  relative group space-y-4
                                  before:absolute before:inset-0
                                  before:bg-gradient-to-r before:from-cyan-500/[0.02] before:to-transparent
                                  before:opacity-0 before:transition-opacity before:duration-300
                                  hover:before:opacity-100
                                ">
                                  {/* Recording Instructions */}
                                  <div className="space-y-3">
                                    <h3 className="font-satoshi text-[12px] text-gray-300/90">
                                      Create an AI voice clone with a short voice sample:
                                    </h3>
                                    <ul className="space-y-2">
                                      {[
                                        'Record 10-20 seconds of clear speech',
                                        'Speak naturally at your normal pace',
                                        'Avoid background noise and echoes'
                                      ].map((text, i) => (
                                        <li key={i} className="flex items-start gap-2">
                                          <span className="text-cyan-400/80 mt-1.5 text-[10px]">•</span>
                                          <span className="font-satoshi text-[13px] text-gray-400/80">{text}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>

                                  {/* Sample Text Section */}
                                  <div className="space-y-2">
                                    <h3 className="font-satoshi text-[12px] text-gray-300/90">
                                      Sample Text to Read:
                                    </h3>
                                    <div className={`
                                      ${styles.knowledgeBase.content}
                                      min-h-0
                                      text-[11px]
                                      bg-black/20
                                  border border-gray-800/50
                                      group-hover:border-cyan-500/20
                                  transition-all duration-300
                                        `}>
                                      &ldquo;In just a few quick steps my voice based AI assistant will be integrated into my content. This way you can speak to others without being there... how cool is that?&rdquo;
                                    </div>
                                  </div>

                                  {/* Voice Recording Controls */}
                                  <div className="space-y-3 pt-2 relative z-[60]">
                                    <input
                                      type="text"
                                      value={voiceName}
                                      onChange={(e) => setVoiceName(e.target.value)}
                                      placeholder="Enter voice name"
                                      className="w-full bg-gray-800/50 border border-gray-700 rounded-lg
                                    px-3 py-2 text-xs text-gray-300
                                        transition-all duration-300
                                    focus:ring-2 focus:ring-cyan-500 focus:border-transparent
                                    hover:border-cyan-500/50
                                        hover:shadow-[0_0_15px_rgba(0,255,255,0.1)]
                                        relative z-[60]"
                                    />

                                    <button
                                      onClick={isRecording ? stopRecording : startRecording}
                                      className={`
                                        relative z-[60]
                                        w-full px-4 py-2 rounded-lg text-xs font-medium
                                        transition-all duration-300
                                        flex items-center justify-center gap-2
                                        ${isRecording
                                          ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                                          : 'bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30'
                                        }
                                        shadow-[0_0_15px_rgba(0,255,255,0.1)]
                                        hover:shadow-[0_0_20px_rgba(0,255,255,0.15)]
                                        transform hover:-translate-y-0.5
                                      `}
                                    >
                                      <span className={`
                                        w-1.5 h-1.5 rounded-full 
                                        ${isRecording
                                          ? 'bg-red-500 animate-[pulse_1s_ease-in-out_infinite]'
                                          : 'bg-cyan-500'
                                        }
                                      `} />
                                      {isRecording ? (
                                        <>Recording... {formatTime(recordingTime)}</>
                                      ) : (
                                        'Start Recording'
                                      )}
                                    </button>
                                  </div>

                                  {/* Recording Preview */}
                                  {currentRecording && (
                                    <div className="space-y-2 relative z-[60]">
                                      <div className="bg-gray-800/30 rounded-lg p-2">
                                        <audio
                                          src={URL.createObjectURL(currentRecording)}
                                          controls
                                          className="w-full h-7"
                                        />
                                      </div>
                                      <button
                                        onClick={handleCloneVoice}
                                        disabled={!voiceName || isCloning}
                                        className={`
                                          relative z-[60]
                                          w-full px-4 py-2 rounded-lg text-xs font-medium
                                      transition-all duration-300
                                          transform hover:-translate-y-0.5
                                          bg-cyan-500/20 text-cyan-400 
                                      hover:bg-cyan-500/30 
                                          shadow-[0_0_15px_rgba(0,255,255,0.1)]
                                          hover:shadow-[0_0_20px_rgba(0,255,255,0.15)]
                                          disabled:opacity-50 disabled:cursor-not-allowed
                                          disabled:hover:transform-none
                                        `}
                                      >
                                        {isCloning ? (
                                          <div className="flex items-center justify-center gap-2">
                                            <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                            Creating Voice Clone...
                                          </div>
                                        ) : (
                                          'Create Voice Clone'
                                        )}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </section>
                            </div>
                          ) : (
                            // Voice List Section
                            <div className="space-y-4">
                              <section className={styles.section.wrapper}>
                                <h2 className={styles.section.title}>Voice Selection</h2>
                                <div className="space-y-3 relative z-[100]">
                                  {savedVoices.map((voice) => (
                                    <motion.div
                                      key={voice.id}
                                      layout
                                      className={`
                                        relative group z-[100]
                                        bg-[#1E1E1E]/50 backdrop-blur-sm
                                        border border-gray-800/50 rounded-lg p-3
                                        transition-all duration-300
                                        hover:border-cyan-500/30
                                        hover:shadow-[0_0_20px_rgba(34,211,238,0.07)]
                                        cursor-pointer
                                        ${voice.status === 'active' ? 'border-cyan-500/30 bg-cyan-500/5' : ''}
                                      `}
                                      onClick={async () => {
                                        try {
                                          if (voice.status !== 'active') {
                                            // Activate this voice
                                            const response = await fetch(`${params.apiBaseUrl}/brdges/${params.brdgeId}/voice/activate`, {
                                              method: 'POST',
                                              body: JSON.stringify({ voice_id: voice.id }),
                                              headers: {
                                                'Content-Type': 'application/json',
                                                ...(localStorage.getItem('token') ? {
                                                  'Authorization': `Bearer ${localStorage.getItem('token')}`
                                                } : {})
                                              },
                                              credentials: 'omit'
                                            });

                                            if (response.ok) {
                                              const responseData = await response.json();
                                              if (responseData.voice) {
                                                setSavedVoices(prev => prev.map(v => ({
                                                  ...v,
                                                  status: v.id === voice.id ? 'active' : 'inactive'
                                                })));
                                              }
                                            }
                                          } else {
                                            // Deactivate this voice
                                            const response = await fetch(`${params.apiBaseUrl}/brdges/${params.brdgeId}/voice/deactivate`, {
                                              method: 'POST',
                                              body: JSON.stringify({ voice_id: voice.id }),
                                              headers: {
                                                'Content-Type': 'application/json',
                                                ...(localStorage.getItem('token') ? {
                                                  'Authorization': `Bearer ${localStorage.getItem('token')}`
                                                } : {})
                                              },
                                              credentials: 'omit'
                                            });

                                            if (response.ok) {
                                              const responseData = await response.json();
                                              if (responseData.voice) {
                                                setSavedVoices(prev => prev.map(v => ({
                                                  ...v,
                                                  status: v.id === voice.id ? 'inactive' : v.status
                                                })));
                                              }
                                            }
                                          }
                                        } catch (error) {
                                          console.error('Error toggling voice:', error);
                                        }
                                      }}
                                    >
                                      <div className="flex items-center justify-between relative z-[100]">
                                        <div className="flex items-center gap-2">
                                          <div className={`
                                            w-2.5 h-2.5 rounded-full
                                            ${voice.status === 'active' ? 'bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.5)]' : 'bg-gray-600'}
                                            transition-all duration-300
                                            group-hover:scale-110
                                          `} />
                                          <span className="text-[13px] text-gray-300 group-hover:text-cyan-400/90 transition-colors duration-300">
                                            {voice.name}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <span className={`
                                            text-[10px] px-2 py-0.5 rounded-md
                                            transition-all duration-300
                                            ${voice.status === 'active' ? `
                                              text-cyan-400/70
                                              bg-cyan-500/10
                                              border border-cyan-500/20
                                              shadow-[0_0_10px_rgba(34,211,238,0.1)]
                                            ` : `
                                              text-gray-500
                                              bg-gray-800/50
                                              border border-gray-700/30
                                              opacity-0 group-hover:opacity-100
                                            `}
                                          `}>
                                            {voice.status === 'active' ? 'Active' : 'Click to Toggle'}
                                          </span>
                                        </div>
                                      </div>
                                      <div className={`
                                        mt-2 text-[11px] text-gray-500
                                        transition-all duration-300
                                        ${voice.status === 'active' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
                                      `}>
                                        Created {new Date(voice.created_at).toLocaleDateString()}
                                      </div>
                                    </motion.div>
                                  ))}
                                </div>
                              </section>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {isMobile && <MobileFAB />}
    </div>
  );
}
