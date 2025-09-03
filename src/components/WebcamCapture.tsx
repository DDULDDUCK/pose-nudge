import React, { useRef, useCallback, useState, useEffect } from 'react';
import Webcam from 'react-webcam';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { convertFileSrc } from '@tauri-apps/api/core';
import { load, Store } from '@tauri-apps/plugin-store'; // Store 타입을 명시적으로 import
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { 
  Camera, 
  CameraOff, 
  Activity, 
  AlertTriangle, 
  Target, 
  CheckCircle, 
  XCircle,
  PlayCircle,
  StopCircle,
  Settings2,
  Lightbulb,
  Cpu,
  ZoomIn,
} from 'lucide-react';

// DB 유틸리티 함수를 import 합니다.
import { getDb } from '@/lib/db';

// --- 인터페이스 정의 ---
interface PostureAnalysis {
  turtle_neck: boolean;
  shoulder_misalignment: boolean;
  posture_score: number;
  recommendations: string[];
  confidence?: number;
  skip?: boolean;
}

interface MonitoringStatus {
  active: boolean;
  background: boolean;
  power_save: boolean;
}

// --- 상태 표시 UI 컴포넌트 ---
interface StatusItemProps {
  label: string;
  isBad: boolean;
  detectedText?: string;
}

const StatusItem: React.FC<StatusItemProps> = ({ label, isBad, detectedText }) => (
  <div className="flex items-center justify-between rounded-lg p-3 bg-slate-50">
    <span className="text-sm font-medium text-slate-700">{label}</span>
    <div className={`flex items-center gap-2 text-sm font-semibold ${isBad ? 'text-red-500' : 'text-emerald-500'}`}>
      {isBad ? <XCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
      <span>{isBad ? (detectedText || '감지됨') : '정상'}</span>
    </div>
  </div>
);


const WebcamCapture: React.FC = () => {
  const [store, setStore] = useState<Store | null>(null);
  
  // --- State 정의 ---
  const webcamRef = useRef<Webcam>(null);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isBackgroundMonitoring, setIsBackgroundMonitoring] = useState(false);
  const [isPowerSaveMode, setIsPowerSaveMode] = useState(true);
  const [isWebcamReady, setIsWebcamReady] = useState(false);
  const [isModelInitialized, setIsModelInitialized] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<PostureAnalysis | null>(null);
  const [error, setError] = useState<string>('');
  const [initializationProgress, setInitializationProgress] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [calibrationStatus, setCalibrationStatus] = useState<'idle' | 'calibrating' | 'success' | 'error'>('idle');
  const [calibratedImage, setCalibratedImage] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // --- 핵심 로직 함수들 (useCallback으로 최적화) ---
  const videoConstraints = { width: 640, height: 480, facingMode: 'user' };

  const initializeModel = useCallback(async () => {
    if (isModelInitialized) return;
    try {
      setInitializationProgress('AI 모델 초기화 중...');
      await invoke('initialize_pose_model');
      setIsModelInitialized(true);
      setInitializationProgress('');
      setError('');
    } catch (err) {
      setError('AI 모델 초기화에 실패했습니다. 네트워크를 확인해주세요.');
      setInitializationProgress('');
    }
  }, [isModelInitialized]);

  const captureAndAnalyze = useCallback(async (forceAnalysis = false) => {
    if (isAnalyzing || !webcamRef.current || (!isMonitoring && !forceAnalysis) || !isModelInitialized) return;
    try {
      setIsAnalyzing(true);
      const imageSrc = webcamRef.current.getScreenshot();
      if (!imageSrc) {
        setError('웹캠 이미지를 캡처할 수 없습니다.');
        setIsAnalyzing(false);
        return;
      }

      const resultStr = await invoke<string>('analyze_pose_data', { imageData: imageSrc });
      const parsedResult: PostureAnalysis = JSON.parse(resultStr);

      if (!parsedResult.skip) {
        setAnalysisResult(parsedResult);
        
        // 분석 결과를 DB에 저장합니다.
        try {
          const db = await getDb();
          await db.execute(
            "INSERT INTO posture_log (score, is_turtle_neck, is_shoulder_misaligned, timestamp) VALUES ($1, $2, $3, $4)",
            [
              parsedResult.posture_score,
              parsedResult.turtle_neck,
              parsedResult.shoulder_misalignment,
              Math.floor(Date.now() / 1000)
            ]
          );
        } catch (dbError) {
          console.error("DB 저장 실패:", dbError);
        }
      }
      setError('');
    } catch (err) {
      setError(`자세 분석 중 오류 발생: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsAnalyzing(false);
    }
  }, [isMonitoring, isModelInitialized, isAnalyzing]);

  const startMonitoring = useCallback(async () => {
    if (!isModelInitialized) { await initializeModel(); return; }
    try {
      await invoke('start_monitoring');
      setIsMonitoring(true);
      setTimeout(() => captureAndAnalyze(true), 100);
    } catch (err) { setError('모니터링 시작에 실패했습니다.'); }
  }, [captureAndAnalyze, isModelInitialized, initializeModel]);

  const stopMonitoring = useCallback(async () => {
    try {
      await invoke('stop_monitoring');
      setIsMonitoring(false);
    } catch (err) { setError('모니터링 중지에 실패했습니다.'); }
  }, []);

  const handleBackgroundMonitoringToggle = useCallback(async (checked: boolean) => {
    try {
      await invoke(checked ? 'start_background_monitoring' : 'stop_background_monitoring');
      setIsBackgroundMonitoring(checked);
    } catch (err) { setError('백그라운드 모니터링 설정에 실패했습니다.'); }
  }, []);

  const handlePowerSaveModeToggle = useCallback(async (checked: boolean) => {
    try {
      await invoke('set_power_save_mode', { enabled: checked });
      setIsPowerSaveMode(checked);
    } catch (err) { setError('전력 절약 모드 설정에 실패했습니다.'); }
  }, []);

  const handleCalibrate = useCallback(async () => {
    if (!webcamRef.current || !isModelInitialized || !store) {
      setError('모델, 웹캠 또는 저장소가 준비되지 않았습니다.');
      return;
    }
    setCalibrationStatus('calibrating');
    setError('');
    try {
      const imageSrc = webcamRef.current.getScreenshot();
      if (!imageSrc) throw new Error('웹캠 이미지를 캡처할 수 없습니다.');
      
      const filePath = await invoke<string>('save_calibrated_image', { imageData: imageSrc });
      await invoke('calibrate_user_posture', { imageData: imageSrc });
      const imageUrl = await convertFileSrc(filePath);
      const cacheBustedUrl = `${imageUrl}?t=${new Date().getTime()}`;

      await store.set('calibratedImagePath', filePath);
      await store.save(); 

      setCalibratedImage(cacheBustedUrl);
      setCalibrationStatus('success');
      setTimeout(() => setCalibrationStatus('idle'), 3000);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`자세 캘리브레이션에 실패했습니다: ${errorMessage}`);
      setCalibrationStatus('error');
      setTimeout(() => setCalibrationStatus('idle'), 3000);
    }
  }, [isModelInitialized, store]);

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const storeInstance = await load('.settings.dat');

        setStore(storeInstance);

        const savedImagePath = await storeInstance.get<string>('calibratedImagePath');
        if (savedImagePath) {
          const imageUrl = await convertFileSrc(savedImagePath);
          const cacheBustedUrl = `${imageUrl}?t=${new Date().getTime()}`;
          setCalibratedImage(cacheBustedUrl);
        }
      
        const status = await invoke<MonitoringStatus>('get_monitoring_status');
        setIsMonitoring(status.active);
        setIsBackgroundMonitoring(status.background);
        setIsPowerSaveMode(status.power_save);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error('초기 데이터 로드 실패:', errorMessage);
        setError(`설정 또는 상태를 불러오는 데 실패했습니다: ${errorMessage}`);
      }
    };
    loadInitialData();

    const unlistenPromise = listen('posture-alert', (event) => {
      setError(event.payload as string);
      setTimeout(() => setError(''), 5000);
    });
    return () => { 
      unlistenPromise.then(unlistenFn => unlistenFn());
    };
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isMonitoring && isModelInitialized) {
      interval = setInterval(() => captureAndAnalyze(false), 3000); // 3초 간격
    }
    return () => { if (interval) clearInterval(interval); };
  }, [isMonitoring, isModelInitialized, captureAndAnalyze]);

  useEffect(() => {
    if (isWebcamReady && !isModelInitialized) {
      initializeModel();
    }
  }, [isWebcamReady, isModelInitialized, initializeModel]);

  const onUserMedia = useCallback(() => setIsWebcamReady(true), []);
  const onUserMediaError = useCallback(() => setError('웹캠에 접근할 수 없습니다. 카메라 권한을 확인해주세요.'), []);

  const getPostureStatusColor = (score?: number | null): string => {
    if (score == null) return 'ring-slate-300';
    if (score >= 80) return 'ring-emerald-500';
    if (score >= 60) return 'ring-amber-500';
    return 'ring-red-500';
  };
  const isReadyToMonitor = isWebcamReady && isModelInitialized;

  return (
    <div className="p-4 md:p-6 lg:p-8 bg-slate-50 min-h-screen">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">실시간 자세 분석</h1>
          <p className="text-muted-foreground">웹캠을 통해 실시간으로 자세를 분석하고 교정합니다.</p>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 왼쪽: 웹캠 및 분석 결과 */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="overflow-hidden">
            <div className={`relative group ${!isMonitoring ? 'grayscale' : ''}`}>
              <Webcam 
                ref={webcamRef} 
                audio={false} 
                videoConstraints={videoConstraints} 
                onUserMedia={onUserMedia} 
                onUserMediaError={onUserMediaError} 
                className="w-full h-auto aspect-video transition-all" 
                screenshotFormat="image/jpeg"
              />
              <div className={`absolute inset-0 transition-all ring-4 ring-inset pointer-events-none ${getPostureStatusColor(analysisResult?.posture_score)}`} />
              {isMonitoring && analysisResult && (
                <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-sm text-white p-3 rounded-lg text-left">
                  <p className="text-sm font-medium">현재 자세 점수</p>
                  <p className="text-4xl font-bold">{analysisResult.posture_score}<span className="text-2xl">/100</span></p>
                </div>
              )}
              {isMonitoring && isAnalyzing && (
                <div className="absolute top-4 right-4 bg-black/60 text-white px-3 py-1.5 rounded-full text-xs flex items-center gap-2 animate-pulse">
                  <Activity className="h-4 w-4" /> 분석 중...
                </div>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>실시간 분석 현황</CardTitle>
              <CardDescription>{isMonitoring ? "현재 감지된 자세 정보입니다." : "모니터링을 시작하면 분석 결과가 표시됩니다."}</CardDescription>
            </CardHeader>
            <CardContent>
              {isMonitoring && analysisResult ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <StatusItem label="거북목" isBad={analysisResult.turtle_neck} detectedText="주의" />
                    <StatusItem label="어깨 비대칭" isBad={analysisResult.shoulder_misalignment} detectedText="불균형" />
                  </div>
                  <div className="space-y-3">
                    {analysisResult.recommendations.length > 0 && (
                      <div className="p-3 bg-blue-50 rounded-lg">
                        <h4 className="font-semibold text-sm mb-2 flex items-center gap-2 text-blue-800"><Lightbulb className="h-4 w-4"/>개선 팁</h4>
                        <ul className="space-y-1 text-xs text-blue-700 list-disc list-inside">
                          {analysisResult.recommendations.map((rec, i) => <li key={i}>{rec}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-10 text-slate-500">
                  <CameraOff className="mx-auto h-12 w-12 mb-2" />
                  <p>모니터링 비활성화 상태</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 오른쪽: 컨트롤 패널 */}
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader><CardTitle>컨트롤 패널</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Button onClick={() => isMonitoring ? stopMonitoring() : startMonitoring()} disabled={!isReadyToMonitor} className="w-full" variant={isMonitoring ? 'destructive' : 'default'} size="lg">
                {isMonitoring ? <StopCircle className="mr-2 h-5 w-5" /> : <PlayCircle className="mr-2 h-5 w-5" />}
                {isMonitoring ? '모니터링 중지' : '모니터링 시작'}
              </Button>
              <div className="text-xs text-center text-muted-foreground pt-1">
                {!isReadyToMonitor && (initializationProgress || "웹캠과 AI 모델을 준비 중입니다...")}
              </div>
              <div className="flex justify-around text-sm pt-2">
                <span className={`flex items-center gap-1.5 ${isWebcamReady ? 'text-emerald-600' : 'text-slate-400'}`}><Camera className="h-4 w-4"/> 웹캠 {isWebcamReady ? 'ON' : 'OFF'}</span>
                <span className={`flex items-center gap-1.5 ${isModelInitialized ? 'text-emerald-600' : 'text-slate-400'}`}><Cpu className="h-4 w-4"/> AI 모델 {isModelInitialized ? 'ON' : 'OFF'}</span>
              </div>
            </CardContent>
            <Separator className="my-4"/>
            <CardContent>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Target className="h-4 w-4"/>자세 캘리브레이션</h3>
              <Button onClick={handleCalibrate} disabled={!isReadyToMonitor || calibrationStatus === 'calibrating'} className="w-full" variant="outline">
                {calibrationStatus === 'calibrating' ? '저장 중...' : '현재 자세를 기준으로 설정'}
              </Button>
              <p className="text-xs text-muted-foreground mt-2">바른 자세를 취한 후 버튼을 눌러 기준점을 설정하세요.</p>
              {calibrationStatus === 'success' && <p className="text-xs text-emerald-600 mt-1">✅ 성공적으로 저장되었습니다.</p>}
              {calibrationStatus === 'error' && <p className="text-xs text-red-600 mt-1">❌ 저장에 실패했습니다.</p>}
              {calibratedImage && (
                <div className="mt-4">
                  <p className="text-xs font-semibold mb-2 text-slate-600">저장된 자세:</p>
                  <div className="relative w-28 h-auto aspect-[4/3] rounded-lg overflow-hidden cursor-pointer group border-2 border-slate-200" onClick={() => setIsPreviewOpen(true)}>
                    <img src={calibratedImage} alt="Calibrated posture thumbnail" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300">
                      <ZoomIn className="h-8 w-8 text-white" />
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Settings2 className="h-5 w-5"/>부가 설정</CardTitle>
              <CardDescription>앱의 세부 동작을 제어하여 사용자 경험을 최적화합니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between p-3 rounded-lg transition-colors hover:bg-slate-100">
                <div className="space-y-0.5">
                  <label htmlFor="bg-monitor" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    백그라운드 모니터링
                    <span className={`ml-2 text-xs font-bold ${isBackgroundMonitoring ? 'text-blue-600' : 'text-slate-500'}`}>
                      {isBackgroundMonitoring ? '활성화' : '비활성화'}
                    </span>
                  </label>
                  <p className="text-xs text-muted-foreground">앱이 최소화 상태일 때도 자세 분석을 계속합니다.</p>
                </div>
                <Switch 
                  id="bg-monitor" 
                  checked={isBackgroundMonitoring} 
                  onCheckedChange={handleBackgroundMonitoringToggle} 
                  disabled={!isModelInitialized}
                  aria-label="백그라운드 모니터링 토글"
                />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg transition-colors hover:bg-slate-100">
                <div className="space-y-0.5">
                  <label htmlFor="power-save" className="text-sm font-medium leading-none">
                    적응형 전력 절약
                    <span className={`ml-2 text-xs font-bold ${isPowerSaveMode ? 'text-blue-600' : 'text-slate-500'}`}>
                      {isPowerSaveMode ? '활성화' : '비활성화'}
                    </span>
                  </label>
                  <p className="text-xs text-muted-foreground">사용자 움직임이 없을 때 분석 빈도를 줄여 리소스를 아낍니다.</p>
                </div>
                <Switch
                  id="power-save"
                  checked={isPowerSaveMode}
                  onCheckedChange={handlePowerSaveModeToggle}
                  aria-label="적응형 전력 절약 모드 토글"
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>저장된 기준 자세</DialogTitle></DialogHeader>
          {calibratedImage && (<img src={calibratedImage} alt="Calibrated Posture Preview" className="rounded-lg w-full h-auto aspect-video" />)}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default WebcamCapture;