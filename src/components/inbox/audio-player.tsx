"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Play, Pause, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface AudioPlayerProps {
  url: string;
  isAgent?: boolean;
  className?: string;
}

/** Generate a deterministic realistic-looking waveform array based on URL */
function generateWaveformBars(seed: string, count = 36): number[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }

  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    const pseudoRandom = Math.abs(Math.sin(hash + i * 9999));
    const heightPercent = Math.max(20, Math.min(100, Math.floor(pseudoRandom * 80 + 20)));
    bars.push(heightPercent);
  }
  return bars;
}

export function AudioPlayer({
  url,
  isAgent = false,
  className,
}: AudioPlayerProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<1 | 1.5 | 2>(1);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveformRef = useRef<HTMLDivElement | null>(null);

  const waveformBars = useMemo(() => generateWaveformBars(url, 36), [url]);

  // Load media (fetch blob if proxy URL)
  const loadAudio = useCallback(async () => {
    if (!url) return;

    if (url.startsWith("/api/whatsapp/media/")) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load audio");
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        setSrc(blobUrl);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    } else {
      setSrc(url);
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    loadAudio();
    return () => {
      if (src?.startsWith("blob:")) {
        URL.revokeObjectURL(src);
      }
    };
  }, [loadAudio]);

  const togglePlay = () => {
    if (!audioRef.current || error || loading) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      void audioRef.current.play();
    }
  };

  const togglePlaybackRate = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rates: (1 | 1.5 | 2)[] = [1, 1.5, 2];
    const nextIndex = (rates.indexOf(playbackRate) + 1) % rates.length;
    const nextRate = rates[nextIndex];
    setPlaybackRate(nextRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!waveformRef.current || !audioRef.current || !duration) return;
    const rect = waveformRef.current.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percentage = clickX / rect.width;
    const newTime = percentage * duration;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-muted/50 p-2 text-xs text-muted-foreground">
        <ImageOff className="h-4 w-4" />
        <span>Áudio indisponível</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-xl p-2.5 min-w-[240px] max-w-[300px] select-none",
        isAgent
          ? "bg-primary text-primary-foreground"
          : "bg-muted/80 text-foreground border border-border/40",
        className
      )}
    >
      {/* Audio Element */}
      {src && (
        <audio
          ref={audioRef}
          src={src}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            setIsPlaying(false);
            setCurrentTime(0);
          }}
          onLoadedMetadata={() => {
            if (audioRef.current) {
              setDuration(audioRef.current.duration || 0);
            }
          }}
          onTimeUpdate={() => {
            if (audioRef.current) {
              setCurrentTime(audioRef.current.currentTime);
            }
          }}
        />
      )}

      <div className="flex items-center gap-3">
        {/* Play/Pause Button */}
        <button
          type="button"
          onClick={togglePlay}
          disabled={loading}
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95 shadow-md",
            isAgent
              ? "bg-primary-foreground text-primary hover:bg-primary-foreground/90"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
          title={isPlaying ? "Pausar" : "Reproduzir"}
        >
          {loading ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : isPlaying ? (
            <Pause className="h-4 w-4 fill-current" />
          ) : (
            <Play className="h-4 w-4 fill-current translate-x-0.5" />
          )}
        </button>

        {/* Waveform Visualization & Slider */}
        <div className="flex flex-1 flex-col justify-center gap-1 min-w-0">
          <div
            ref={waveformRef}
            onClick={handleSeek}
            className="group relative flex h-7 items-center gap-[2.5px] cursor-pointer py-1"
          >
            {waveformBars.map((heightPercent, idx) => {
              const barPercent = (idx / waveformBars.length) * 100;
              const isPlayed = barPercent <= progressPercent;

              return (
                <div
                  key={idx}
                  className="flex-1 rounded-full transition-all duration-150"
                  style={{
                    height: `${heightPercent}%`,
                    backgroundColor: isPlayed
                      ? isAgent
                        ? "#38bdf8" // Cyan highlight for played bars in agent bubble
                        : "#0284c7" // Blue highlight for played bars in customer bubble
                      : isAgent
                      ? "rgba(255, 255, 255, 0.4)" // Dimmed white for unplayed in agent bubble
                      : "rgba(100, 116, 139, 0.35)", // Dimmed slate for unplayed in customer bubble
                  }}
                />
              );
            })}

            {/* Blue Progress Dot Thumb */}
            <div
              className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full shadow-md transition-all duration-75"
              style={{
                left: `calc(${progressPercent}% - 7px)`,
                backgroundColor: isAgent ? "#38bdf8" : "#0284c7",
              }}
            />
          </div>

          {/* Time & Speed Controls */}
          <div className="flex items-center justify-between text-[11px] font-medium opacity-85">
            <span>
              {isPlaying || currentTime > 0
                ? formatTime(currentTime)
                : formatTime(duration)}
            </span>

            <button
              type="button"
              onClick={togglePlaybackRate}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-bold tracking-tight transition-colors",
                isAgent
                  ? "bg-primary-foreground/20 hover:bg-primary-foreground/30 text-primary-foreground"
                  : "bg-muted-foreground/15 hover:bg-muted-foreground/25 text-foreground"
              )}
              title="Velocidade de reprodução"
            >
              {playbackRate}x
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
