// src/components/WebcamCapture.tsx

import React, { useRef, useCallback, useState, useEffect } from 'react';
import Webcam from 'react-webcam';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { convertFileSrc } from '@tauri-apps/api/core';
import { load, Store } from '@tauri-apps/plugin-store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Camera,
  CameraOff,
  Activity,
  Target,
  CheckCircle,
  XCircle,
  PlayCircle,
  StopCircle,
  Lightbulb,
  Cpu,
  ZoomIn,
} from 'lucide-react';
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
}

// --- 상태 표시 UI 컴포넌트 ---
const StatusItem: React.FC<{ label: string; isBad: boolean; detectedText?: string; }> = ({ label, isBad, detectedText }) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between rounded-lg p-3 bg-slate-50">
      <span className="text-sm font-medium text-slate-700">{t(label, label)}</span>
      <div className={`flex items-center gap-2 text-sm font-semibold ${isBad ? 'text-red-500' : 'text-emerald-500'}`}>
        {isBad ? <XCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
        <span>{isBad ? t(detectedText || 'detected', detectedText || '감지됨') : t('normal', '정상')}</span>
      </div>
    </div>
  );
};


const WebcamCapture: React.FC = () => {
  const { t } = useTranslation();
  const [store, setStore] = useState<Store | null>(null);
  
  // --- State 정의 ---
  const webcamRef = useRef<Webcam>(null);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isWebcamReady, setIsWebcamReady] = useState(false);
  const [isModelInitialized, setIsModelInitialized] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<PostureAnalysis | null>(null);
  const [error, setError] = useState<string>('');
  const [initializationProgress, setInitializationProgress] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [calibrationStatus, setCalibrationStatus] = useState<'idle' | 'calibrating' | 'success' | 'error'>('idle');
  const [calibratedImage, setCalibratedImage] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const getSelectedCamera = () => {
    const id = localStorage.getItem('pose_nudge_camera');
    return id && id !== 'null' ? id : undefined;
  };
  const videoConstraints = {
    facingMode: 'user',
    deviceId: getSelectedCamera(),
  };

  const initializeModel = useCallback(async () => {
    if (isModelInitialized) return;
    try {
      setInitializationProgress(t('webcam.initModel', 'AI 모델 초기화 중...'));
      await invoke('initialize_pose_model');
      setIsModelInitialized(true);
      setInitializationProgress('');
      setError('');
    } catch (err) {
      setError(t('webcam.initModelError', 'AI 모델 초기화에 실패했습니다. 네트워크를 확인해주세요.'));
      setInitializationProgress('');
    }
  }, [isModelInitialized, t]);

  const captureAndAnalyze = useCallback(async (forceAnalysis = false) => {
    if (isAnalyzing || !webcamRef.current || (!isMonitoring && !forceAnalysis) || !isModelInitialized) return;
    try {
      setIsAnalyzing(true);
      const imageSrc = webcamRef.current.getScreenshot();
      if (!imageSrc) {
        setError(t('webcam.captureError', '웹캠 이미지를 캡처할 수 없습니다.'));
        setIsAnalyzing(false);
        return;
      }

      const resultStr = await invoke<string>('analyze_pose_data', { imageData: imageSrc });
      const parsedResult: PostureAnalysis = JSON.parse(resultStr);

      if (!parsedResult.skip) {
        setAnalysisResult(parsedResult);
        
        const db = await getDb();
        await db.execute(
          "INSERT INTO posture_log (score, is_turtle_neck, is_shoulder_misaligned, timestamp) VALUES ($1, $2, $3, $4)",
          [
            parsedResult.posture_score,
            parsedResult.turtle_neck ? 1 : 0,
            parsedResult.shoulder_misalignment ? 1 : 0,
            Math.floor(Date.now() / 1000)
          ]
        );
      }
      setError('');
    } catch (err) {
      console.error("분석 또는 DB 저장 실패:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(t('webcam.analysisError', `자세 분석 중 오류 발생: ${errorMessage}`));
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
    } catch (err) { setError(t('webcam.monitoringStartError', '모니터링 시작에 실패했습니다.')); }
  }, [captureAndAnalyze, isModelInitialized, initializeModel]);

  const stopMonitoring = useCallback(async () => {
    try {
      await invoke('stop_monitoring');
      setIsMonitoring(false);
    } catch (err) { setError(t('webcam.monitoringStopError', '모니터링 중지에 실패했습니다.') + error); }
  }, []);

  const handleCalibrate = useCallback(async () => {
    if (!webcamRef.current || !isModelInitialized || !store) {
      setError(t('webcam.calibrationNotReady', '모델, 웹캠 또는 저장소가 준비되지 않았습니다.'));
      return;
    }
    setCalibrationStatus('calibrating');
    setError('');
    try {
      const imageSrc = webcamRef.current.getScreenshot();
      if (!imageSrc) throw new Error(t('webcam.captureError', '웹캠 이미지를 캡처할 수 없습니다.'));
      
      const filePath = await invoke<string>('save_calibrated_image', { imageData: imageSrc });
      await invoke('calibrate_user_posture', { imageData: imageSrc });
      const imageUrl = convertFileSrc(filePath);
      const cacheBustedUrl = `${imageUrl}?t=${new Date().getTime()}`;

      await store.set('calibratedImagePath', filePath);
      await store.save(); 

      setCalibratedImage(cacheBustedUrl);
      setCalibrationStatus('success');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(t('webcam.calibrationError', `자세 캘리브레이션에 실패했습니다: ${errorMessage}`));
      setCalibrationStatus('error');
    } finally {
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
          const imageUrl = convertFileSrc(savedImagePath);
          const cacheBustedUrl = `${imageUrl}?t=${new Date().getTime()}`;
          setCalibratedImage(cacheBustedUrl);
        }
      
        const status = await invoke<MonitoringStatus>('get_monitoring_status');
        setIsMonitoring(status.active);
      } catch (err) {
        console.error('초기 데이터 로드 실패:', err);
      }
    };
    loadInitialData();

    const unlistenPromise = listen<string>('posture-alert', (event) => {
      window.dispatchEvent(new CustomEvent('pose-nudge-toast', { detail: event.payload }));
      // 기존 setError 제거: 알림은 NotificationSystem에서 처리
    });
    return () => { 
      unlistenPromise.then(unlistenFn => unlistenFn());
    };
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isMonitoring && isModelInitialized) {
      interval = setInterval(() => captureAndAnalyze(false), 3000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [isMonitoring, isModelInitialized, captureAndAnalyze]);

  useEffect(() => {
    if (isWebcamReady && !isModelInitialized) {
      initializeModel();
    }
  }, [isWebcamReady, isModelInitialized, initializeModel]);

  const onUserMedia = useCallback(() => setIsWebcamReady(true), []);
  const onUserMediaError = useCallback(() => setError(t('webcam.permissionError', '웹캠에 접근할 수 없습니다. 카메라 권한을 확인해주세요.')), [t]);

  const getPostureStatusColor = (score?: number | null): string => {
    if (score == null) return 'ring-slate-300';
    if (score >= 80) return 'ring-emerald-500';
    if (score >= 60) return 'ring-amber-500';
    return 'ring-red-500';
  };
  
  const isReadyToMonitor = isWebcamReady && isModelInitialized;

  return (
    <div className="space-y-6">
      {/* error 상태는 NotificationSystem 토스트로 대체 */}

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
                className="w-full h-full object-contain aspect-video transition-all bg-slate-200"
                screenshotFormat="image/jpeg"
              />
              <div className={`absolute inset-0 transition-all ring-4 ring-inset pointer-events-none ${getPostureStatusColor(analysisResult?.posture_score)}`} />
              {isMonitoring && analysisResult && (
                <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-sm text-white p-3 rounded-lg text-left">
                  <p className="text-sm font-medium">{t('webcam.currentScore', '현재 자세 점수')}</p>
                  <p className="text-4xl font-bold">{analysisResult.posture_score}<span className="text-2xl">{t('dashboard.scoreUnit', '/100')}</span></p>
                </div>
              )}
              {isMonitoring && isAnalyzing && (
                <div className="absolute top-4 right-4 bg-black/60 text-white px-3 py-1.5 rounded-full text-xs flex items-center gap-2 animate-pulse">
                  <Activity className="h-4 w-4" /> {t('webcam.analyzing', '분석 중...')}
                </div>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('webcam.realtimeStatus', '실시간 분석 현황')}</CardTitle>
              <CardDescription>
                {isMonitoring
                  ? t('webcam.currentDetected', '현재 감지된 자세 정보입니다.')
                  : t('webcam.startMonitoringDesc', '모니터링을 시작하면 분석 결과가 표시됩니다.')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isMonitoring && analysisResult ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <StatusItem label="webcam.turtleNeck" isBad={analysisResult.turtle_neck} detectedText="webcam.caution" />
                    <StatusItem label="webcam.shoulderMisalign" isBad={analysisResult.shoulder_misalignment} detectedText="webcam.imbalance" />
                  </div>
                  <div className="space-y-3">
                    {analysisResult.recommendations.length > 0 && (
                      <div className="p-3 bg-blue-50 rounded-lg">
                        <h4 className="font-semibold text-sm mb-2 flex items-center gap-2 text-blue-800"><Lightbulb className="h-4 w-4"/>{t('dashboard.tipsTitle', '개선 팁')}</h4>
                        <ul className="space-y-1 text-xs text-blue-700 list-disc list-inside">
                          {analysisResult.recommendations.map((rec, i) => <li key={i}>{t(`dashboard.tips.${rec}`, rec)}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-10 text-slate-500">
                  <CameraOff className="mx-auto h-12 w-12 mb-2" />
                  <p>{t('webcam.monitoringInactive', '모니터링 비활성화 상태')}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 오른쪽: 컨트롤 패널 */}
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader><CardTitle>{t('webcam.controlPanel', '컨트롤 패널')}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Button onClick={() => isMonitoring ? stopMonitoring() : startMonitoring()} disabled={!isReadyToMonitor} className="w-full" variant={isMonitoring ? 'destructive' : 'default'} size="lg">
                {isMonitoring ? <StopCircle className="mr-2 h-5 w-5" /> : <PlayCircle className="mr-2 h-5 w-5" />}
                {isMonitoring ? t('webcam.stopMonitoring', '모니터링 중지') : t('webcam.startMonitoring', '모니터링 시작')}
              </Button>
              <div className="text-xs text-center text-muted-foreground pt-1 h-4">
                {!isReadyToMonitor && (initializationProgress || t('webcam.preparing', '웹캠과 AI 모델을 준비 중입니다...'))}
              </div>
              <div className="flex justify-around text-sm pt-2">
                <span className={`flex items-center gap-1.5 ${isWebcamReady ? 'text-emerald-600' : 'text-slate-400'}`}><Camera className="h-4 w-4"/>{t('webcam.webcam', '웹캠')} {isWebcamReady ? 'ON' : 'OFF'}</span>
                <span className={`flex items-center gap-1.5 ${isModelInitialized ? 'text-emerald-600' : 'text-slate-400'}`}><Cpu className="h-4 w-4"/>{t('webcam.aiModel', 'AI 모델')} {isModelInitialized ? 'ON' : 'OFF'}</span>
              </div>
            </CardContent>
            <Separator className="my-4"/>
            <CardContent>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Target className="h-4 w-4"/>{t('webcam.calibration', '자세 캘리브레이션')}</h3>
              <Button onClick={handleCalibrate} disabled={!isReadyToMonitor || calibrationStatus === 'calibrating'} className="w-full" variant="outline">
                {calibrationStatus === 'calibrating' ? t('webcam.saving', '저장 중...') : t('webcam.setCurrentPosture', '현재 자세를 기준으로 설정')}
              </Button>
              <p className="text-xs text-muted-foreground mt-2">{t('webcam.calibrationGuide', '바른 자세를 취한 후 버튼을 눌러 기준점을 설정하세요.')}</p>
              {calibrationStatus === 'success' && <p className="text-xs text-emerald-600 mt-1">✅ {t('webcam.saveSuccess', '성공적으로 저장되었습니다.')}</p>}
              {calibrationStatus === 'error' && <p className="text-xs text-red-600 mt-1">❌ {t('webcam.saveError', '저장에 실패했습니다.')}</p>}
              {calibratedImage && (
                <div className="mt-4">
                  <p className="text-xs font-semibold mb-2 text-slate-600">{t('webcam.savedPosture', '저장된 자세:')}</p>
                  <div className="relative w-28 h-auto aspect-[4/3] rounded-lg overflow-hidden cursor-pointer group border-2 border-slate-200" onClick={() => setIsPreviewOpen(true)}>
                    <img src={calibratedImage} alt={t('webcam.calibratedThumbnail', 'Calibrated posture thumbnail')} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300">
                      <ZoomIn className="h-8 w-8 text-white" />
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{t('webcam.savedReferencePosture', '저장된 기준 자세')}</DialogTitle></DialogHeader>
          {calibratedImage && (<img src={calibratedImage} alt={t('webcam.calibratedPreview', 'Calibrated Posture Preview')} className="rounded-lg w-full h-auto aspect-video" />)}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default WebcamCapture;
