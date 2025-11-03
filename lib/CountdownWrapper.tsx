'use client'

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react'

// Generic server action types
interface ServerTimeResponse {
  success: boolean
  data?: {
    startTime?: string 
    timeLeft: number
    isValid?: boolean
  }
  error?: string
}

interface CountdownContextType {
  timeLeft: number      
  formattedTime: string 
  startTime: string
  clearStartTime: () => void
  isServerTimeValid: boolean
  isLoading: boolean
}

const CountdownContext = createContext<CountdownContextType | undefined>(undefined)

interface CountdownWrapperProps {
  children: ReactNode
  testId: string  // Generic test ID (can be aptitudeId, codingRoundId, etc.)
  durationMinutes: number
  // Configurable server actions
  serverActions?: {
    startSession: (testId: string) => Promise<ServerTimeResponse>
    getTimeLeft: (testId: string) => Promise<ServerTimeResponse>
  }
  // Configurable localStorage prefix
  localStoragePrefix?: string
}


export default function CountdownWrapper({
  children,
  testId,
  durationMinutes,
  serverActions,
  localStoragePrefix = 'test'
}: CountdownWrapperProps) {
  const [startTime, setStartTime] = useState<string>('')
  const [timeLeft, setTimeLeft] = useState(durationMinutes * 60 * 1000)
  const [isServerTimeValid, setIsServerTimeValid] = useState(true)
  const [isLoading, setIsLoading] = useState(true)

  // Fallback localStorage functions (kept for backup)
  const getOrCreateLocalStartTime = (): string => {
    if (typeof window !== 'undefined') {
      const storageKey = `${localStoragePrefix}_start_time_${testId}`;
      const existing = localStorage.getItem(storageKey);
      
      if (existing) {
        // Check if test is still valid (within duration)
        const startTimeMs = new Date(existing).getTime();
        const now = Date.now();
        const elapsedMs = now - startTimeMs;
        const maxDurationMs = durationMinutes * 60 * 1000;
        
        if (elapsedMs < maxDurationMs) {
          return existing; // Use existing start time
        } else {
          // Test expired, clear and create new
          localStorage.removeItem(storageKey);
        }
      }
      
      // Create new start time
      const newStartTime = new Date().toISOString();
      localStorage.setItem(storageKey, newStartTime);
      return newStartTime;
    }
    return new Date().toISOString();
  };

  // Initialize test session with server (primary method)
  useEffect(() => {
    const initializeTestSession = async () => {
      try {
        setIsLoading(true);
        
        // Use provided server actions or fallback to localStorage only
        if (serverActions?.startSession) {
          const result = await serverActions.startSession(testId)
          
          if (result.success && result.data) {
            // Use server time as primary source
            if (result.data.startTime) {
              setStartTime(result.data.startTime)
              setIsServerTimeValid(true)
              
              // Also save to localStorage as backup
              if (typeof window !== 'undefined') {
                localStorage.setItem(`${localStoragePrefix}_start_time_${testId}`, result.data.startTime);
              }
            }
            setTimeLeft(result.data.timeLeft)
          } else {
            console.error('Failed to initialize test session:', result.error)
            // Fallback to localStorage
            const fallbackStartTime = getOrCreateLocalStartTime();
            setStartTime(fallbackStartTime);
            setIsServerTimeValid(false);
          }
        } else {
          // No server actions provided, use localStorage only
          const fallbackStartTime = getOrCreateLocalStartTime();
          setStartTime(fallbackStartTime);
          setIsServerTimeValid(false);
        }
      } catch (error) {
        console.error('Error initializing test session:', error)
        // Fallback to localStorage
        const fallbackStartTime = getOrCreateLocalStartTime();
        setStartTime(fallbackStartTime);
        setIsServerTimeValid(false);
      } finally {
        setIsLoading(false);
      }
    }

    initializeTestSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testId, localStoragePrefix])

 
  useEffect(() => {
    if (!startTime || !serverActions?.getTimeLeft) return

    const verifyServerTime = async () => {
      try {
        const result = await serverActions.getTimeLeft(testId)
        
        if (result.success && result.data) {
          setTimeLeft(result.data.timeLeft)
          setIsServerTimeValid(result.data.isValid ?? true)
          
          // Auto-submit if time expired on server
          if (result.data.isValid === false) {
            window.dispatchEvent(new CustomEvent('testTimeExpired'))
          }
        }
      } catch (error) {
        console.error('Error verifying server time:', error)
        
      }
    }

    
    const serverInterval = setInterval(verifyServerTime, 30000)
    
    return () => clearInterval(serverInterval)
  }, [testId, startTime, serverActions])

  // Local countdown (for UI responsiveness)
  useEffect(() => {
    if (!startTime || timeLeft <= 0) return

    const updateCountdown = () => {
      setTimeLeft(prev => {
        const newTime = prev - 1000
        if (newTime <= 0) {
          window.dispatchEvent(new CustomEvent('testTimeExpired'))
          return 0
        }
        return newTime
      })
    }

    const interval = setInterval(updateCountdown, 1000)
    return () => clearInterval(interval)
  }, [startTime, timeLeft])

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }


  const clearStartTime = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(`${localStoragePrefix}_start_time_${testId}`);
    }
    
  };

  const value: CountdownContextType = {
    timeLeft,
    formattedTime: formatTime(timeLeft),
    startTime,
    clearStartTime,
    isServerTimeValid,
    isLoading
  }

  return <CountdownContext.Provider value={value}>{children}</CountdownContext.Provider>
}


export const useCountdown = (): CountdownContextType => {
  const context = useContext(CountdownContext)
  if (context === undefined) {
    throw new Error('useCountdown must be used within a CountdownWrapper')
  }
  return context
}