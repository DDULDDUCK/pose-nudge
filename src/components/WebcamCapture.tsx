import React, { useRef, useCallback, useState, useEffect } from 'react';
import Webcam from 'react-webcam';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
// ★★★ Button과 새로운 아이콘(Target)을 import합니다.
import { Button } from '@/components/ui/button';
import { Camera, CameraOff, Activity, AlertTriangle, Battery, Zap, Moon, Target } from 'lucide-react';

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

const WebcamCapture: React.FC = () => {
  const webcamRef = useRef<Webcam>(null);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isBackgroundMonitoring, setIsBackgroundMonitoring] = useState(false);
  const [isPowerSaveMode, setIsPowerSaveMode] = useState(true);
  const [isWebcamReady, setIsWebcamReady] = useState(false);
  const [isModelInitialized, setIsModelInitialized] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<PostureAnalysis | null>(null);
  const [error, setError] = useState<string>('');
  const [analysisInterval, setAnalysisInterval] = useState<NodeJS.Timeout | null>(null);
  const [initializationProgress, setInitializationProgress] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  // ★★★ 캘리브레이션 상태를 관리하기 위한 state 추가
  const [calibrationStatus, setCalibrationStatus] = useState<'idle' | 'calibrating' | 'success' | 'error'>('idle');


  const videoConstraints = {
    width: 640,
    height: 480,
    facingMode: 'user'
  };

  // 모델 초기화
  const initializeModel = useCallback(async () => {
    if (isModelInitialized) return;
    
    try {
      setInitializationProgress('YOLO-pose 모델 초기화 중...');
      await invoke('initialize_pose_model');
      setIsModelInitialized(true);
      setInitializationProgress('');
      setError('');
    } catch (err) {
      console.error('모델 초기화 실패:', err);
      setError('AI 모델 초기화에 실패했습니다. 네트워크 연결을 확인해주세요.');
      setInitializationProgress('');
    }
  }, [isModelInitialized]);

  const captureAndAnalyze = useCallback(async (forceAnalysis = false) => {
    if (isAnalyzing) {
      console.log('이미 분석이 진행 중입니다. 이번 요청은 건너뜁니다.');
      return;
    }

    if (!webcamRef.current || (!isMonitoring && !forceAnalysis) || !isModelInitialized) {
      console.log('분석 조건 미충족:', {
        webcam: !!webcamRef.current,
        monitoring: isMonitoring,
        modelInit: isModelInitialized,
        forceAnalysis
      });
      return;
    }

    try {
      setIsAnalyzing(true);
      console.log('웹캠에서 이미지 캡처 시도...');
      const imageSrc = webcamRef.current.getScreenshot();
      if (!imageSrc) {
        console.error('웹캠에서 이미지 캡처 실패');
        setError('웹캠에서 이미지를 캡처할 수 없습니다');
        setIsAnalyzing(false); // ★★★ 에러 발생 시 isAnalyzing 상태를 false로 변경
        return;
      }
      console.log('백엔드로 분석 요청 전송 중...');
      
      const result = await invoke<string>('analyze_pose_data', {
        imageData: imageSrc
      });
      console.log('✅ 백엔드 응답 수신 완료:', result);
      
      // 스킵 여부 상세 확인
      if (result.includes('"skip"')) {
        console.log('❌ 백엔드에서 분석 스킵됨 - 분석 간격 체크 실패');
      } else {
        console.log('🎉 백엔드에서 실제 분석 수행됨!');
      }
      
      const parsedResult: PostureAnalysis = JSON.parse(result);
      // 전력 절약 모드에서 스킵된 분석은 무시 (파싱 후 상태 업데이트 전에 return)
      if (parsedResult.skip) {
        console.log('전력 절약 모드로 인해 분석 스킵됨');
        return; // 여기서 함수를 종료해야 analysisResult가 업데이트되지 않음
      }
      
      console.log('분석 결과 파싱 완료:', parsedResult);
      setAnalysisResult(parsedResult);
      setError('');
    } catch (err) {
      console.error('자세 분석 중 오류:', err);
      setError(`자세 분석 중 오류가 발생했습니다: ${err}`);
    } finally {
        setIsAnalyzing(false); // 분석이 성공하든 실패하든 항상 상태를 false로 변경
    }
  }, [isMonitoring, isModelInitialized, isAnalyzing]); // ★★★ isAnalyzing 의존성 추가

  // ... (startMonitoring, stopMonitoring 등 다른 함수들은 그대로 유지) ...
  const startMonitoring = useCallback(async () => {
    if (!isModelInitialized) {
      await initializeModel();
      return;
    }
    
    try {
      console.log('모니터링 시작 요청...');
      await invoke('start_monitoring');
      console.log('백엔드 모니터링 상태 활성화 완료');
      
      setIsMonitoring(true); // 상태만 변경
      console.log('프론트엔드 모니터링 상태를 true로 설정 요청');
      
      // 상태 업데이트 후 즉시 분석 실행
      setTimeout(() => {
        console.log('강제 분석 실행 중...');
        captureAndAnalyze(true);
      }, 100);
      
    } catch (err) {
      console.error('모니터링 시작 실패:', err);
      setError('모니터링을 시작할 수 없습니다');
    }
  }, [captureAndAnalyze, isModelInitialized, initializeModel]);

  const stopMonitoring = useCallback(async () => {
    try {
      await invoke('stop_monitoring');
      setIsMonitoring(false); // 상태만 변경
      // 인터벌 클리어 로직은 useEffect로 이동
    } catch (err) {
      console.error('모니터링 중지 실패:', err);
      setError('모니터링을 중지할 수 없습니다');
    }
  }, []);

  const handleMonitoringToggle = useCallback(async (checked: boolean) => {
    if (checked) {
      await startMonitoring();
    } else {
      await stopMonitoring();
    }
  }, [startMonitoring, stopMonitoring]);

  const handleBackgroundMonitoringToggle = useCallback(async (checked: boolean) => {
    try {
      if (checked) {
        await invoke('start_background_monitoring');
        setIsBackgroundMonitoring(true);
      } else {
        await invoke('stop_background_monitoring');
        setIsBackgroundMonitoring(false);
      }
    } catch (err) {
      console.error('백그라운드 모니터링 토글 실패:', err);
      setError('백그라운드 모니터링 설정을 변경할 수 없습니다');
    }
  }, []);

  const handlePowerSaveModeToggle = useCallback(async (checked: boolean) => {
    try {
      console.log(`전력 절약 모드 ${checked ? '활성화' : '비활성화'} 요청 중...`);
      await invoke('set_power_save_mode', { enabled: checked });
      console.log(`백엔드 전력 절약 모드 설정 완료: ${checked}`);
      setIsPowerSaveMode(checked);
      console.log(`프론트엔드 전력 절약 모드 상태 업데이트: ${checked}`);
    } catch (err) {
      console.error('전력 절약 모드 토글 실패:', err);
      setError('전력 절약 모드 설정을 변경할 수 없습니다');
    }
  }, []);


  // ★★★ 캘리브레이션 함수 추가
  const handleCalibrate = useCallback(async () => {
    if (!webcamRef.current || !isModelInitialized) {
      setError('모델이 준비되지 않았거나 웹캠이 없습니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    
    setCalibrationStatus('calibrating');
    setError('');

    try {
      const imageSrc = webcamRef.current.getScreenshot();
      if (!imageSrc) {
        throw new Error('웹캠 이미지를 캡처할 수 없습니다.');
      }

      await invoke('calibrate_user_posture', { imageData: imageSrc });
      
      setCalibrationStatus('success');
      // 3초 후에 상태를 다시 idle로 변경하여 사용자에게 피드백 제공
      setTimeout(() => setCalibrationStatus('idle'), 3000);

    } catch (err) {
      console.error('자세 캘리브레이션 실패:', err);
      setError(`자세 캘리브레이션에 실패했습니다: ${String(err)}`);
      setCalibrationStatus('error');
      setTimeout(() => setCalibrationStatus('idle'), 3000);
    }
  }, [isModelInitialized]);


  // 모니터링 상태 로드
  const loadMonitoringStatus = useCallback(async () => {
    try {
      const status = await invoke<MonitoringStatus>('get_monitoring_status');
      setIsMonitoring(status.active);
      setIsBackgroundMonitoring(status.background);
      setIsPowerSaveMode(status.power_save);
    } catch (err) {
      console.error('모니터링 상태 로드 실패:', err);
    }
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    if (isMonitoring && isModelInitialized) {
      console.log('모니터링 활성화 상태. 분석 인터벌을 설정합니다.');
      interval = setInterval(() => {
        captureAndAnalyze(false);
      }, 2000); // 2초 간격으로 주기적 분석
    }

    // 컴포넌트가 언마운트되거나 isMonitoring이 false로 바뀔 때 인터벌 정리
    return () => {
      if (interval) {
        console.log('분석 인터벌을 정리합니다.');
        clearInterval(interval);
      }
    };
  }, [isMonitoring, isModelInitialized, captureAndAnalyze]); 

  useEffect(() => {
    loadMonitoringStatus();
    
    // 백그라운드 알림 이벤트 리스너
    const unlistenPostureAlert = listen('posture-alert', (event) => {
      const message = event.payload as string;
      setError(message); // 임시로 error 필드에 표시
      setTimeout(() => setError(''), 5000); // 5초 후 자동 제거
    });

    return () => {
      // analysisInterval 상태를 사용하지 않으므로, 이 부분은 제거해도 됩니다.
      // if (analysisInterval) {
      //   clearInterval(analysisInterval);
      // }
      unlistenPostureAlert.then(unlisten => unlisten());
    };
  }, [loadMonitoringStatus]); // analysisInterval 의존성 제거

  // 컴포넌트 마운트 시 모델 초기화
  useEffect(() => {
    if (isWebcamReady && !isModelInitialized) {
      initializeModel();
    }
  }, [isWebcamReady, isModelInitialized, initializeModel]);

  const onUserMedia = useCallback(() => {
    setIsWebcamReady(true);
    setError('');
  }, []);

  const onUserMediaError = useCallback((error: string | DOMException) => {
    console.error('웹캠 접근 오류:', error);
    setError('웹캠에 접근할 수 없습니다. 카메라 권한을 확인해주세요.');
    setIsWebcamReady(false);
  }, []);

  const getPostureScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getPostureScoreBackground = (score: number) => {
    if (score >= 80) return 'bg-green-100';
    if (score >= 60) return 'bg-yellow-100';
    return 'bg-red-100';
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              웹캠 자세 모니터링
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {initializationProgress && (
            <Alert>
              <Activity className="h-4 w-4" />
              <AlertDescription>{initializationProgress}</AlertDescription>
            </Alert>
          )}

          {/* ★★★ 캘리브레이션 성공/실패 알림 추가 */}
          {calibrationStatus === 'success' && (
            <Alert variant="default" className="bg-green-100 border-green-200 text-green-800">
              <AlertDescription>✅ 바른 자세가 성공적으로 저장되었습니다!</AlertDescription>
            </Alert>
          )}
          {calibrationStatus === 'error' && (
            <Alert variant="destructive">
              <AlertDescription>❌ 자세 저장에 실패했습니다. 다시 시도해주세요.</AlertDescription>
            </Alert>
          )}

          <div className="space-y-4">
            {/* ... 스위치들은 그대로 ... */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Switch
                  id="monitoring-toggle"
                  checked={isMonitoring}
                  onCheckedChange={handleMonitoringToggle}
                  disabled={!isWebcamReady || !isModelInitialized}
                />
                <label htmlFor="monitoring-toggle" className="text-sm font-medium">
                  실시간 모니터링 {isMonitoring ? '활성화' : '비활성화'}
                </label>
              </div>
              
              <div className="flex items-center gap-2">
                {isWebcamReady ? (
                  <div className="flex items-center gap-1 text-green-600">
                    <Camera className="h-4 w-4" />
                    <span className="text-sm">연결됨</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-red-600">
                    <CameraOff className="h-4 w-4" />
                    <span className="text-sm">연결 안됨</span>
                  </div>
                )}
                
                {isModelInitialized && (
                  <div className="flex items-center gap-1 text-blue-600">
                    <Zap className="h-4 w-4" />
                    <span className="text-xs">AI 준비됨</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Switch
                  id="background-monitoring-toggle"
                  checked={isBackgroundMonitoring}
                  onCheckedChange={handleBackgroundMonitoringToggle}
                  disabled={!isModelInitialized}
                />
                <label htmlFor="background-monitoring-toggle" className="text-sm font-medium">
                  백그라운드 모니터링 {isBackgroundMonitoring ? '활성화' : '비활성화'}
                </label>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Switch
                  id="power-save-toggle"
                  checked={isPowerSaveMode}
                  onCheckedChange={handlePowerSaveModeToggle}
                />
                <label htmlFor="power-save-toggle" className="text-sm font-medium">
                  적응형 전력 절약 {isPowerSaveMode ? '활성화' : '비활성화'}
                </label>
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="relative">
                <Webcam
                  ref={webcamRef}
                  audio={false}
                  videoConstraints={videoConstraints}
                  onUserMedia={onUserMedia}
                  onUserMediaError={onUserMediaError}
                  className="w-full rounded-lg border"
                  screenshotFormat="image/jpeg"
                />
                {isMonitoring && (
                  <div className="absolute top-2 right-2 bg-red-500 text-white px-2 py-1 rounded-full text-xs flex items-center gap-1">
                    <Activity className="h-3 w-3" />
                    분석 중
                  </div>
                )}
              </div>

              {/* ★★★ 캘리브레이션 버튼 추가 */}
              <Card>
                <CardContent className="pt-6">
                    <div className="flex flex-col items-start gap-4">
                        <Button 
                          onClick={handleCalibrate}
                          disabled={!isWebcamReady || !isModelInitialized || calibrationStatus === 'calibrating'}
                          className="w-full"
                        >
                          <Target className="mr-2 h-4 w-4" />
                          {calibrationStatus === 'calibrating' ? '저장 중...' : '현재 자세를 바른 자세로 설정'}
                        </Button>
                        <p className="text-xs text-gray-500">
                          <strong>사용법:</strong> 척추를 곧게 펴고 정면을 바라보는 바른 자세를 취한 후, 위 버튼을 눌러주세요. 이 자세를 기준으로 거북목을 더 정확하게 감지합니다.
                        </p>
                    </div>
                </CardContent>
              </Card>

            </div>

            <div className="space-y-4">
              {/* ... 분석 결과 표시는 그대로 ... */}
              {analysisResult && !analysisResult.skip && ( // ★★★ skip된 결과는 표시하지 않도록 조건 추가
                <>
                  <Card className={getPostureScoreBackground(analysisResult.posture_score)}>
                    <CardContent className="pt-6">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">자세 점수</span>
                          <span className={`text-2xl font-bold ${getPostureScoreColor(analysisResult.posture_score)}`}>
                            {analysisResult.posture_score}/100
                          </span>
                        </div>
                        <Progress
                          value={analysisResult.posture_score}
                          className="h-2"
                        />
                        {analysisResult.confidence !== undefined && (
                          <div className="flex items-center justify-between text-xs text-gray-500">
                            <span>AI 신뢰도</span>
                            <span>{Math.round(analysisResult.confidence * 100)}%</span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">자세 상태</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span>거북목</span>
                        <span className={analysisResult.turtle_neck ? 'text-red-600 font-semibold' : 'text-green-600'}>
                          {analysisResult.turtle_neck ? '감지됨' : '정상'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>어깨 정렬</span>
                        <span className={analysisResult.shoulder_misalignment ? 'text-red-600 font-semibold' : 'text-green-600'}>
                          {analysisResult.shoulder_misalignment ? '불량' : '정상'}
                        </span>
                      </div>
                    </CardContent>
                  </Card>

                  {analysisResult.recommendations.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">개선 권장사항</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-2">
                          {analysisResult.recommendations.map((recommendation, index) => (
                            <li key={index} className="flex items-start gap-2">
                              <span className="text-blue-500 mt-1">•</span>
                              <span className="text-sm">{recommendation}</span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default WebcamCapture;