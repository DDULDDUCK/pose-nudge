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
  //PlayCircle,
  StopCircle,
  Lightbulb,
  Cpu,
  ZoomIn,
} from 'lucide-react';
//import { getDb } from '@/lib/db';

// --- 인터페이스 정의 ---
interface PostureAnalysis {
  turtle_neck: boolean;
  shoulder_misalignment: boolean;
  posture_score: number;
  recommendations: string[];
  confidence?: number;
}

interface MonitoringStatus {
  active: boolean;
}

// --- 상태 표시 UI 컴포넌트 ---
const StatusItem: React.FC<{ label: string; isBad: boolean; detectedText?: string; }> = ({ label, isBad, detectedText }) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between rounded-lg p-3 bg-slate-50">
      <span className="text-sm font-medium text-slate-700">{t(label)}</span>
      <div className={`flex items-center gap-2 text-sm font-semibold ${isBad ? 'text-red-500' : 'text-emerald-500'}`}>
        {isBad ? <XCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
        <span>
          {isBad
            ? (detectedText ? t(detectedText) : t('webcam.detected', 'Detected'))
            : t('webcam.normal', 'Normal')}
        </span>
      </div>
    </div>
  );
};


const WebcamCapture: React.FC = () => {
  const { t } = useTranslation();
  const [store, setStore] = useState<Store | null>(null);
  
  const webcamRef = useRef<Webcam>(null);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isWebcamReady, setIsWebcamReady] = useState(false);
  const [isModelInitialized, setIsModelInitialized] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<PostureAnalysis | null>(null);
  const [error, setError] = useState<string>(''); // setError는 유지하되, 사용처가 줄어듭니다.
  const [initializationProgress, setInitializationProgress] = useState<string>('');
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
    } catch (err) {
      // toast로 에러를 띄우는 것이 더 좋을 수 있습니다.
      console.error(err);
      setError(t('webcam.initModelError', 'AI 모델 초기화에 실패했습니다.'));
      setInitializationProgress('');
    }
  }, [isModelInitialized, t]);
  
  // ★★★★★ 제거: 프론트엔드의 주기적인 캡처 및 분석 관련 함수들은 모두 삭제합니다. ★★★★★
  // const captureAndAnalyze = useCallback(...);
  // const startMonitoring = useCallback(...);
  // const stopMonitoring = useCallback(...);

  // '캘리브레이션' 기능은 프론트엔드 웹캠을 사용해야 하므로 그대로 유지합니다.
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
          setCalibratedImage(`${imageUrl}?t=${new Date().getTime()}`);
        }
      
        const status = await invoke<MonitoringStatus>('get_monitoring_status');
        setIsMonitoring(status.active);
      } catch (err) {
        console.error('초기 데이터 로드 실패:', err);
      }
    };
    loadInitialData();

    // 백엔드 이벤트 리스너 설정
    const unlistenPromises = Promise.all([
      listen<string>('posture-alert', (event) => {
        window.dispatchEvent(new CustomEvent('pose-nudge-toast', { detail: event.payload }));
      }),
      // ★★★★★ 추가: 시스템 트레이에서 상태 변경 시 UI 동기화 ★★★★★
      listen<{ active: boolean }>('monitoring-state-changed', (event) => {
        setIsMonitoring(event.payload.active);
      }),
      // ★★★★★ 추가: 백엔드에서 온 실시간 분석 결과를 받아 UI 업데이트 ★★★★★
      listen<PostureAnalysis>('analysis-update', (event) => {
        // 데이터베이스 저장은 이제 백엔드에서 처리해야 합니다. 여기서는 UI 상태만 업데이트합니다.
        setAnalysisResult(event.payload);
      }),
    ]);

    return () => { 
      unlistenPromises.then(unlisteners => unlisteners.forEach(unlisten => unlisten()));
    };
  }, []);

  // ★★★★★ 제거: 프론트엔드에서 주기적으로 분석을 호출하던 useEffect는 삭제합니다. ★★★★★
  // useEffect(() => { ... setInterval ... }, []);

  useEffect(() => {
    if (isWebcamReady && !isModelInitialized) {
      initializeModel();
    }
  }, [isWebcamReady, isModelInitialized, initializeModel]);

  const onUserMedia = useCallback(() => setIsWebcamReady(true), []);
  const onUserMediaError = useCallback(() => setError(t('webcam.permissionError', '웹캠에 접근할 수 없습니다.')), [t]);

  const getPostureStatusColor = (score?: number | null): string => {
    if (score == null) return 'ring-slate-300';
    if (score >= 80) return 'ring-emerald-500';
    if (score >= 60) return 'ring-amber-500';
    return 'ring-red-500';
  };
  
  const isReadyForUI = isWebcamReady && isModelInitialized;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 왼쪽: 웹캠 및 분석 결과 */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="overflow-hidden">
            <div className={`relative group`}>
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
            </div>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('webcam.realtimeStatus', '실시간 분석 현황')}</CardTitle>
              <CardDescription>
                {t(isMonitoring ? 'webcam.currentDetected' : 'webcam.startMonitoringDescTray', '시스템 트레이 아이콘으로 모니터링을 시작하면 분석 결과가 표시됩니다.')}
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
                          {analysisResult.recommendations.map((rec, i) => (
                            <li key={i}>
                              {t(
                                // dotted key (e.g. "motivation.excellent") => dashboard.<dotted>
                                rec.includes('.') ? `dashboard.${rec}` : `dashboard.tips.${rec}`
                              )}
                            </li>
                          ))}
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
        <div className="lg-col-span-1 space-y-6">
          <Card>
            <CardHeader><CardTitle>{t('webcam.controlPanel', '컨트롤 패널')}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {/* ★★★★★ 변경: 시작/중지 버튼을 상태 표시 UI로 대체 ★★★★★ */}
              <div className={`w-full p-4 rounded-lg text-center font-semibold ${isMonitoring ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                {isMonitoring ? (
                  <div className="flex items-center justify-center gap-2">
                    <Activity className="h-5 w-5" />
                    <span>{t('webcam.monitoringActiveStatus', '모니터링 활성화 중')}</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2">
                    <StopCircle className="h-5 w-5" />
                    <span>{t('webcam.monitoringInactiveStatus', '모니터링 비활성화 중')}</span>
                  </div>
                )}
              </div>
              <p className="text-xs text-center text-muted-foreground pt-1">
                {t('webcam.trayControlGuide', '시스템 트레이 아이콘으로 모니터링을 제어하세요.')}
              </p>
              
              <div className="flex justify-around text-sm pt-2">
                <span className={`flex items-center gap-1.5 ${isWebcamReady ? 'text-emerald-600' : 'text-slate-400'}`}><Camera className="h-4 w-4"/>{t('webcam.webcam', '웹캠')} {isWebcamReady ? 'ON' : 'OFF'}</span>
                <span className={`flex items-center gap-1.5 ${isModelInitialized ? 'text-emerald-600' : 'text-slate-400'}`}><Cpu className="h-4 w-4"/>{t('webcam.aiModel', 'AI 모델')} {isModelInitialized ? 'ON' : 'OFF'}</span>
              </div>
            </CardContent>
            {/* 에러 및 초기화 진행 상태 표시 */}
            {(error || initializationProgress) && (
              <div className="mt-2 space-y-1">
                {error && (
                  <div className="text-xs text-red-600 font-semibold px-2 py-1 rounded bg-red-50 border border-red-200">
                    {error}
                  </div>
                )}
                {initializationProgress && (
                  <div className="text-xs text-slate-500 px-2 py-1 rounded bg-slate-50 border border-slate-200">
                    {initializationProgress}
                  </div>
                )}
              </div>
            )}
            <Separator className="my-4"/>
            <CardContent>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Target className="h-4 w-4"/>{t('webcam.calibration', '자세 캘리브레이션')}</h3>
              <Button onClick={handleCalibrate} disabled={!isReadyForUI || calibrationStatus === 'calibrating'} className="w-full" variant="outline">
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