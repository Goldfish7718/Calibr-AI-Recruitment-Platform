"use client"

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Wifi, Camera, Mic, Maximize2, CheckCircle, 
  AlertTriangle, XCircle, Loader2, Info, 
  ShieldAlert, HelpCircle, Eye, Shield, AlertCircle
} from 'lucide-react';
import type { SystemCheck, CheckStatus } from './type'

export default function SystemCheckPage() {
  const router = useRouter();
  const [checks, setChecks] = useState<SystemCheck[]>([
    { id: 'internet', label: 'Internet Speed', status: 'pending', message: 'Testing connection speed...' },
    { id: 'camera', label: 'Camera Access', status: 'pending', message: 'Checking camera permission...' },
    { id: 'microphone', label: 'Microphone Access', status: 'pending', message: 'Checking microphone permission...' },
    { id: 'fullscreen', label: 'Full-Screen Mode', status: 'pending', message: 'Checking full-screen capability...' },
    { id: 'browser', label: 'Browser Compatibility', status: 'pending', message: 'Checking browser compatibility...' },
    { id: 'cookies', label: 'Cookies Enabled', status: 'pending', message: 'Checking if cookies are enabled...' }
  ]);

  const [isLoading, setIsLoading] = useState(true);

  // Check if all systems are go
  const allChecksPass = checks.every(check => check.status === 'success');

  // Helper to update a specific check
  const updateCheck = (id: string, updates: Partial<SystemCheck>) => {
    setChecks(current => 
      current.map(check => 
        check.id === id ? { ...check, ...updates } : check
      )
    );
  };

  // Internet Speed Check
  const checkInternetSpeed = async () => {
    const startTime = performance.now();
    try {
      const response = await fetch('/api/ping');
      if (!response.ok) throw new Error('Network response was not ok');
      
      const endTime = performance.now();
      const latency = endTime - startTime;
      const speed = Math.round(1000 / latency); // Rough KB/s estimate

      // Evaluate connection quality
      let status: CheckStatus = 'success';
      let message = `Connection speed: ${speed} KB/s (${latency.toFixed(0)}ms latency)`;
      
      if (speed < 30) {
        status = 'error';
        message = `Slow connection detected: ${speed} KB/s. A minimum of 30 KB/s is required.`;
      } else if (speed < 50) {
        status = 'warning';
        message = `Connection may be unstable: ${speed} KB/s. 50+ KB/s recommended.`;
      }

      updateCheck('internet', {
        status,
        message,
        value: speed
      });
    } catch {
      updateCheck('internet', {
        status: 'error',
        message: 'Connection test failed. Please check your internet connection.'
      });
    }
  };

  // Camera Check
  const checkCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      
      // Check if we actually got video tracks
      const videoTracks = stream.getVideoTracks();
      if (videoTracks.length === 0) throw new Error('No video tracks found');
      
      // Get camera info
      const cameraInfo = videoTracks[0].label || 'Default camera';
      
      // Clean up
      stream.getTracks().forEach(track => track.stop());
      
      updateCheck('camera', {
        status: 'success',
        message: `Camera access granted: ${cameraInfo}`
      });
    } catch (error: any) {
      // Handle different error types
      let errorMessage = 'Camera access denied';
      let action: (() => Promise<void>) | undefined = requestCameraPermission;
      
      if (error.name === 'NotFoundError') {
        errorMessage = 'No camera detected on this device';
        action = undefined;
      } else if (error.name === 'NotAllowedError') {
        errorMessage = 'Camera permission denied. Please allow camera access in your browser settings.';
      } else if (error.name === 'NotReadableError') {
        errorMessage = 'Camera is in use by another application';
      }
      
      updateCheck('camera', {
        status: 'error',
        message: errorMessage,
        action
      });
    }
  };
  
  const requestCameraPermission = async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ video: true });
      checkCamera(); // Re-run the check
    } catch{
      // Permission request failed, update with instructions
      updateCheck('camera', {
        status: 'error',
        message: 'Please enable camera access in your browser settings and refresh the page.'
      });
    }
  };

  // Microphone Check
  const checkMicrophone = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Check if we actually got audio tracks
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) throw new Error('No audio tracks found');
      
      // Get microphone info
      const micInfo = audioTracks[0].label || 'Default microphone';
      
      // Clean up
      stream.getTracks().forEach(track => track.stop());
      
      updateCheck('microphone', {
        status: 'success',
        message: `Microphone access granted: ${micInfo}`
      });
    } catch (error: any) {
      // Handle different error types
      let errorMessage = 'Microphone access denied';
      let action: (() => Promise<void>) | undefined = requestMicrophonePermission;
      
      if (error.name === 'NotFoundError') {
        errorMessage = 'No microphone detected on this device';
        action = undefined;
      } else if (error.name === 'NotAllowedError') {
        errorMessage = 'Microphone permission denied. Please allow microphone access in your browser settings.';
      } else if (error.name === 'NotReadableError') {
        errorMessage = 'Microphone is in use by another application';
      }
      
      updateCheck('microphone', {
        status: 'error',
        message: errorMessage,
        action
      });
    }
  };
  
  const requestMicrophonePermission = async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      checkMicrophone(); // Re-run the check
    } catch  {
      // Permission request failed, update with instructions
      updateCheck('microphone', {
        status: 'error',
        message: 'Please enable microphone access in your browser settings and refresh the page.'
      });
    }
  };

  // Fullscreen Check
  const checkFullscreen = () => {
    const isFullscreen = document.fullscreenElement !== null;
    
    // Check if fullscreen is supported
    const fullscreenSupported = document.documentElement.requestFullscreen !== undefined;
    
    if (!fullscreenSupported) {
      updateCheck('fullscreen', {
        status: 'error',
        message: 'Full-screen mode is not supported in your browser'
      });
      return;
    }
    
    updateCheck('fullscreen', {
      status: isFullscreen ? 'success' : 'warning',
      message: isFullscreen 
        ? 'Full-screen mode active' 
        : 'Full-screen mode is required for the assessment. Please enable it.',
      action: isFullscreen ? undefined : requestFullscreen
    });
  };

  const requestFullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen();
      checkFullscreen();
    } catch (error: any) {
      updateCheck('fullscreen', {
        status: 'error',
        message: `Failed to enter full-screen mode: ${error.message || 'Unknown error'}`
      });
    }
  };
  
  // Browser Compatibility Check
  const checkBrowserCompatibility = () => {
    const userAgent = navigator.userAgent;
    const browserInfo = getBrowserInfo(userAgent);
    
    // Check for supported browsers
    const isChrome = browserInfo.browser === 'Chrome' && browserInfo.version >= 88;
    const isFirefox = browserInfo.browser === 'Firefox' && browserInfo.version >= 85;
    const isEdge = browserInfo.browser === 'Edge' && browserInfo.version >= 88;
    const isSafari = browserInfo.browser === 'Safari' && browserInfo.version >= 14;
    
    const isSupported = isChrome || isFirefox || isEdge || isSafari;
    
    updateCheck('browser', {
      status: isSupported ? 'success' : 'warning',
      message: isSupported 
        ? `${browserInfo.browser} ${browserInfo.version} is supported` 
        : `${browserInfo.browser} ${browserInfo.version} may have compatibility issues. We recommend using Chrome 88+, Firefox 85+, Edge 88+, or Safari 14+.`
    });
  };
  
  // Helper function to get browser info
  const getBrowserInfo = (userAgent: string) => {
    let browser = 'Unknown';
    let version = 0;
    
    if (/chrome|chromium|crios/i.test(userAgent)) {
      browser = 'Chrome';
      const match = userAgent.match(/(?:chrome|chromium|crios)\/([\d.]+)/);
      if (match) version = parseInt(match[1]);
    } else if (/firefox|fxios/i.test(userAgent)) {
      browser = 'Firefox';
      const match = userAgent.match(/(?:firefox|fxios)\/([\d.]+)/);
      if (match) version = parseInt(match[1]);
    } else if (/safari/i.test(userAgent) && !/chrome|chromium|crios/i.test(userAgent)) {
      browser = 'Safari';
      const match = userAgent.match(/version\/([\d.]+).*safari/);
      if (match) version = parseInt(match[1]);
    } else if (/edg/i.test(userAgent)) {
      browser = 'Edge';
      const match = userAgent.match(/edg\/([\d.]+)/);
      if (match) version = parseInt(match[1]);
    }
    
    return { browser, version };
  };
  
  // Cookies Check
  const checkCookiesEnabled = () => {
    const cookiesEnabled = navigator.cookieEnabled;
    
    if (cookiesEnabled) {
      // Try to set and read a test cookie to confirm
      const testCookie = 'calibr_test_cookie';
      document.cookie = `${testCookie}=1; path=/; max-age=60`;
      const cookieSet = document.cookie.indexOf(testCookie) !== -1;
      
      updateCheck('cookies', {
        status: cookieSet ? 'success' : 'error',
        message: cookieSet 
          ? 'Cookies are enabled and working properly' 
          : 'Cookies appear to be blocked by your browser settings'
      });
    } else {
      updateCheck('cookies', {
        status: 'error',
        message: 'Cookies are disabled. Please enable cookies in your browser settings.'
      });
    }
  };

  // Run all checks on mount
  useEffect(() => {
    const runChecks = async () => {
      // Run synchronous checks first
      checkBrowserCompatibility();
      checkCookiesEnabled();
      checkFullscreen();
      
      // Then run async checks
      await Promise.all([
        checkInternetSpeed(),
        checkCamera(),
        checkMicrophone()
      ]);
      
      setIsLoading(false);
    };

    runChecks();

    // Listen for fullscreen changes
    document.addEventListener('fullscreenchange', checkFullscreen);
    return () => document.removeEventListener('fullscreenchange', checkFullscreen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getStatusIcon = (status: CheckStatus) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="h-6 w-6 text-emerald-400" />;
      case 'warning':
        return <AlertTriangle className="h-6 w-6 text-amber-400" />;
      case 'error':
        return <XCircle className="h-6 w-6 text-rose-400" />;
      default:
        return <Loader2 className="h-6 w-6 text-indigo-400 animate-spin" />;
    }
  };

  const getCheckIcon = (id: string) => {
    switch (id) {
      case 'internet':
        return <Wifi className="h-6 w-6" />;
      case 'camera':
        return <Camera className="h-6 w-6" />;
      case 'microphone':
        return <Mic className="h-6 w-6" />;
      case 'fullscreen':
        return <Maximize2 className="h-6 w-6" />;
      case 'browser':
        return <ShieldAlert className="h-6 w-6" />;
      case 'cookies':
        return <Info className="h-6 w-6" />;
      default:
        return <HelpCircle className="h-6 w-6" />;
    }
  };

  const [consentGiven, setConsentGiven] = useState(false);
  
  const handleProceed = () => {
    if (allChecksPass && consentGiven) {
      // Save system check results to localStorage for future reference
      const checkResults = checks.map(check => ({
        id: check.id,
        status: check.status,
        value: check.value,
        timestamp: new Date().toISOString()
      }));
      
      localStorage.setItem('calibr_system_check_results', JSON.stringify({
        results: checkResults,
        timestamp: new Date().toISOString(),
        browserInfo: navigator.userAgent
      }));
      
      // Proceed to the assessment process
      router.push('/assessment/process');
    } else if (allChecksPass && !consentGiven) {
      // Show consent required message
      alert('Please confirm that you understand and agree to the assessment requirements');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0A0A18] to-[#0D0D20] flex items-center justify-center p-4">
      <div className="max-w-7xl w-full mt-16 px-8">
        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* Left Column */}
          <div className="space-y-6">
            {/* Div 1: Title */}
            <div className="text-center lg:text-left">
              <h1 className="text-4xl font-bold text-white mb-4">
                System Check
                <span className="bg-gradient-to-r from-indigo-300 to-rose-300 bg-clip-text text-transparent">
                  {" "}Required
                </span>
              </h1>
              <p className="text-white/70">
                Before proceeding with your assessment, we need to verify that your system meets all the technical requirements.
                Please complete all checks below to ensure a smooth assessment experience.
              </p>
            </div>

            {/* Div 2: Troubleshooting Tips */}
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <div className="flex items-center gap-3 mb-4">
                <HelpCircle className="h-5 w-5 text-indigo-300" />
                <h3 className="text-white font-medium">Troubleshooting Tips</h3>
              </div>
              <ul className="text-sm text-white/70 space-y-2 list-disc pl-5">
                <li>If camera or microphone access is denied, check your browser permissions in the address bar or settings.</li>
                <li>For full-screen issues, try using keyboard shortcut F11 (Windows/Linux) or Cmd+Shift+F (Mac).</li>
                <li>If your internet connection is unstable, try connecting to a different network or using a wired connection.</li>
                <li>For browser compatibility issues, we recommend using the latest version of Chrome, Firefox, Edge, or Safari.</li>
                <li>If problems persist, try refreshing the page or using a different browser.</li>
              </ul>
            </div>

            {/* Div 3: Monitoring & Security Instructions */}
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <div className="flex items-center gap-3 mb-4">
                <Eye className="h-5 w-5 text-rose-300" />
                <h3 className="text-white font-medium">Assessment Monitoring & Security</h3>
              </div>
              <div className="text-white/70 text-sm space-y-3">
                <div className="flex items-start gap-2">
                  <Shield className="h-4 w-4 text-rose-300 mt-0.5 flex-shrink-0" />
                  <p>
                    <strong className="text-white">Continuous Monitoring:</strong> Your entire assessment session will be recorded via camera and microphone for security and verification purposes.
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-300 mt-0.5 flex-shrink-0" />
                  <p>
                    <strong className="text-white">Prohibited Activities:</strong> Any form of cheating, unauthorized assistance, or use of external resources will result in immediate disqualification.
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <XCircle className="h-4 w-4 text-rose-300 mt-0.5 flex-shrink-0" />
                  <p>
                    <strong className="text-white">Automatic Detection:</strong> Our AI-powered proctoring system automatically detects suspicious behavior, multiple people in frame, and unauthorized device usage.
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-300 mt-0.5 flex-shrink-0" />
                  <p>
                    <strong className="text-white">Environment Requirements:</strong> Ensure you&aposre in a quiet, private room with good lighting and minimal distractions.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            {/* Div 1: Why We Need These Permissions & System Checks */}
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <div className="flex items-center gap-3 mb-6 pb-4 border-b border-white/10">
                <ShieldAlert className="h-5 w-5 text-indigo-300" />
                <h2 className="text-lg font-medium text-white">Why We Need These Permissions</h2>
              </div>
              
              <div className="text-white/70 text-sm space-y-4 mb-6">
                <p>
                  <strong>Camera & Microphone:</strong> Required for proctoring and identity verification during your assessment.
                  We use these to ensure academic integrity and prevent impersonation.
                </p>
                <p>
                  <strong>Full-Screen Mode:</strong> Required to prevent access to unauthorized resources during the assessment.
                  Exiting full-screen mode during the test may result in automatic submission.
                </p>
                <p>
                  <strong>Internet Connection:</strong> A stable connection is necessary to prevent data loss and ensure your
                  answers are properly submitted.
                </p>
                <p>
                  <strong>Cookies & Browser Compatibility:</strong> Required for proper functioning of the assessment platform
                  and to save your progress.
                </p>
              </div>
              
              <div className="space-y-6">
                {checks.map(check => (
                  <div
                    key={check.id}
                    className={`flex items-center justify-between gap-4 p-4 rounded-xl ${check.status === 'error' ? 'bg-rose-500/10' : check.status === 'warning' ? 'bg-amber-500/10' : check.status === 'success' ? 'bg-emerald-500/10' : 'bg-white/5'}`}
                    role="status"
                    aria-label={`${check.label} check`}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`text-white/80 ${check.status === 'error' ? 'text-rose-300' : check.status === 'warning' ? 'text-amber-300' : check.status === 'success' ? 'text-emerald-300' : 'text-indigo-300'}`}>
                        {getCheckIcon(check.id)}
                      </div>
                      <div>
                        <h3 className="text-white font-medium">{check.label}</h3>
                        <p className="text-sm text-white/70">{check.message}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      {check.action && (check.status === 'error' || check.status === 'warning') && (
                        <button
                          onClick={check.action}
                          className="px-4 py-2 rounded-lg bg-indigo-500/20 text-indigo-300 text-sm hover:bg-indigo-500/30 transition-colors"
                        >
                          Enable
                        </button>
                      )}
                      {getStatusIcon(check.status)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Div 2: Terms and Conditions Checkbox */}
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <div className="flex items-center gap-3 mb-4">
                <Shield className="h-5 w-5 text-indigo-300" />
                <h3 className="text-white font-medium">Terms & Conditions</h3>
              </div>
              <div className="flex items-start gap-3">
                <div className="mt-1">
                  <input 
                    type="checkbox" 
                    id="consent-checkbox"
                    checked={consentGiven}
                    onChange={(e) => setConsentGiven(e.target.checked)}
                    className="h-5 w-5 rounded border-white/30 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0 bg-white/10"
                  />
                </div>
                <label htmlFor="consent-checkbox" className="text-sm text-white/70">
                  I understand that this assessment requires camera and microphone access for proctoring purposes. 
                  I agree to remain in full-screen mode for the duration of the assessment. 
                  I confirm that I will not use unauthorized resources or assistance during the assessment. 
                  I understand that violating these requirements may result in disqualification.
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Proceed Button - Full Width at Bottom */}
        <div className="mt-8 text-center">
          <button
            onClick={handleProceed}
            disabled={!allChecksPass || isLoading || !consentGiven}
            className={`px-8 py-3 rounded-xl font-medium transition-all duration-300 ${
              allChecksPass && consentGiven
                ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                : 'bg-white/10 text-white/30 cursor-not-allowed'
            }`}
            aria-label="Proceed to assessment"
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin mx-auto" />
            ) : (
              'Proceed to Assessment'
            )}
          </button>
          
          {!isLoading && (
            <div className="mt-4">
              {!allChecksPass && (
                <p className="text-amber-300 text-sm mb-2">
                  Please resolve all system check issues before proceeding
                </p>
              )}
              {allChecksPass && !consentGiven && (
                <p className="text-indigo-300 text-sm">
                  Please confirm your consent to proceed
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
