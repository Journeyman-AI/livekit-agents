import React, { useRef, useEffect, useState } from 'react';
import { motion } from 'framer-motion';

interface Word {
    word: string;
    start: number;
    end: number;
    confidence: number;
}

interface Segment {
    text: string;
    start: number;
    end: number;
    speaker?: string;
    words?: Word[];
}

interface TimeAlignedTranscriptProps {
    segments: Segment[];
    currentTime: number;
    onTimeClick: (time: number) => void;
}

export const TimeAlignedTranscript: React.FC<TimeAlignedTranscriptProps> = ({
    segments,
    currentTime,
    onTimeClick,
}) => {
    const activeWordRef = useRef<HTMLSpanElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isUserScrolling, setIsUserScrolling] = useState(false);
    const scrollTimeoutRef = useRef<NodeJS.Timeout>();

    // Enhanced auto-scroll with user interaction detection
    useEffect(() => {
        if (!activeWordRef.current || !containerRef.current || isUserScrolling) return;

        const container = containerRef.current;
        const word = activeWordRef.current;
        const containerWidth = container.offsetWidth;
        const wordPosition = word.offsetLeft;

        // Position the active word at 40% of the container width
        const targetScroll = Math.max(0, wordPosition - (containerWidth * 0.4));

        container.scrollTo({
            left: targetScroll,
            behavior: 'smooth'
        });
    }, [currentTime, isUserScrolling]);

    // Handle user scroll interaction
    const handleScroll = () => {
        setIsUserScrolling(true);

        // Clear existing timeout
        if (scrollTimeoutRef.current) {
            clearTimeout(scrollTimeoutRef.current);
        }

        // Reset after 2 seconds of no scrolling
        scrollTimeoutRef.current = setTimeout(() => {
            setIsUserScrolling(false);
        }, 2000);
    };

    // Cleanup timeout
    useEffect(() => {
        return () => {
            if (scrollTimeoutRef.current) {
                clearTimeout(scrollTimeoutRef.current);
            }
        };
    }, []);

    // Find the currently active word across all segments
    const findActiveWord = () => {
        for (const segment of segments) {
            if (segment.words) {
                for (const word of segment.words) {
                    if (currentTime >= word.start && currentTime <= word.end) {
                        return word;
                    }
                }
            }
        }
        return null;
    };

    const activeWord = findActiveWord();

    return (
        <div className="w-full h-full flex flex-col">
            <div
                ref={containerRef}
                onScroll={handleScroll}
                className="
                    flex-1
                    w-full overflow-x-auto overflow-y-auto
                    whitespace-normal
                    py-2 px-4
                    scrollbar-thin scrollbar-track-transparent 
                    scrollbar-thumb-gray-700/30 hover:scrollbar-thumb-cyan-500/20
                    relative
                "
            >
                {/* Fade effects */}
                <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-black/90 to-transparent pointer-events-none z-10" />
                <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-black/90 to-transparent pointer-events-none z-10" />

                {/* Content container */}
                <div className="
                    flex flex-wrap gap-1.5
                    min-w-full w-full
                    px-[5%]
                    justify-start items-start
                ">
                    {segments.map((segment, segmentIndex) => (
                        <div
                            key={segmentIndex}
                            className="inline-flex items-center gap-1 flex-shrink-0"
                        >
                            {segment.words ? (
                                segment.words.map((word, wordIndex) => {
                                    const isActiveWord = activeWord?.start === word.start && activeWord?.end === word.end;

                                    return (
                                        <motion.span
                                            key={`${segmentIndex}-${wordIndex}`}
                                            ref={isActiveWord ? activeWordRef : null}
                                            initial={{ opacity: 0.8 }}
                                            animate={{
                                                opacity: isActiveWord ? 1 : 0.8,
                                                scale: isActiveWord ? 1.1 : 1,
                                                color: isActiveWord ? 'rgb(34,211,238)' : 'rgb(209,213,219)'
                                            }}
                                            transition={{
                                                duration: 0.15,
                                                ease: "easeOut"
                                            }}
                                            className={`
                                                inline-block cursor-pointer text-[13px] leading-relaxed
                                                px-1.5 py-0.5 rounded
                                                transition-all duration-150
                                                hover:text-cyan-400 hover:scale-105
                                                ${isActiveWord ? 'bg-cyan-500/20 shadow-[0_0_15px_rgba(34,211,238,0.3)]' : 'hover:bg-cyan-500/10'}
                                            `}
                                            onClick={() => onTimeClick(word.start)}
                                        >
                                            {word.word}
                                        </motion.span>
                                    );
                                })
                            ) : (
                                // Fallback to segment-level if no word data
                                <motion.span
                                    initial={{ opacity: 0.8 }}
                                    animate={{
                                        opacity: currentTime >= segment.start && currentTime <= segment.end ? 1 : 0.8,
                                        scale: currentTime >= segment.start && currentTime <= segment.end ? 1.1 : 1,
                                        color: currentTime >= segment.start && currentTime <= segment.end ? 'rgb(34,211,238)' : 'rgb(209,213,219)'
                                    }}
                                    transition={{ duration: 0.15, ease: "easeOut" }}
                                    className={`
                                        inline-block cursor-pointer text-[13px] leading-relaxed
                                        px-1.5 py-0.5 rounded
                                        transition-all duration-150
                                        hover:text-cyan-400 hover:scale-105
                                        ${currentTime >= segment.start && currentTime <= segment.end ?
                                            'bg-cyan-500/20 shadow-[0_0_15px_rgba(34,211,238,0.3)]' :
                                            'hover:bg-cyan-500/10'
                                        }
                                    `}
                                    onClick={() => onTimeClick(segment.start)}
                                >
                                    {segment.text}
                                </motion.span>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

const formatTime = (time: number): string => {
    if (!time && time !== 0) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}; 