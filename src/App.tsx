import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Dashboard from '@/components/Dashboard';
import WebcamCapture from '@/components/WebcamCapture';
import NotificationSystem from '@/components/NotificationSystem';
import {
  LayoutDashboard,
  Camera,
  Settings,
  Info,
  Monitor,
  Heart,
  TrendingUp,
  Activity
} from 'lucide-react';
import './App.css';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [testResults, setTestResults] = useState<string>('');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Monitor className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Pose Nudge</h1>
              <p className="text-sm text-gray-500">AI 기반 자세 교정 도우미</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-sm text-gray-600">
              <Heart className="w-4 h-4 text-red-500" />
              <span>건강한 자세로 더 나은 삶을</span>
            </div>
          </div>
        </div>
      </header>

      {/* 메인 컨텐츠 */}
      <main className="container mx-auto px-6 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="dashboard" className="flex items-center gap-2">
              <LayoutDashboard className="w-4 h-4" />
              대시보드
            </TabsTrigger>
            <TabsTrigger value="webcam" className="flex items-center gap-2">
              <Camera className="w-4 h-4" />
              실시간 모니터링
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              설정
            </TabsTrigger>
            <TabsTrigger value="about" className="flex items-center gap-2">
              <Info className="w-4 h-4" />
              정보
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">대시보드</h2>
                <p className="text-gray-600">자세 분석 결과와 통계를 확인하세요</p>
              </div>
            </div>
            <Dashboard />
          </TabsContent>

          <TabsContent value="webcam" className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">실시간 모니터링</h2>
                <p className="text-gray-600">웹캠을 통해 실시간으로 자세를 분석합니다</p>
              </div>
            </div>
            <WebcamCapture />
          </TabsContent>

          <TabsContent value="settings" className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">설정</h2>
                <p className="text-gray-600">앱 동작을 사용자화하세요</p>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings className="h-5 w-5" />
                    알림 설정
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">자세 알림 활성화</span>
                    <Button variant="outline" size="sm">설정</Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">알림 간격 (초)</span>
                    <Button variant="outline" size="sm">30초</Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">휴식 알림</span>
                    <Button variant="outline" size="sm">30분</Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    AI 분석 설정
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">거북목 민감도</span>
                    <Button variant="outline" size="sm">보통</Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">어깨 정렬 민감도</span>
                    <Button variant="outline" size="sm">보통</Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">AI 신뢰도 임계값</span>
                    <Button variant="outline" size="sm">50%</Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Camera className="h-5 w-5" />
                    카메라 & 전력 설정
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">해상도</span>
                    <Button variant="outline" size="sm">640x480</Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">적응형 전력 절약</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-green-600">권장</span>
                      <Button variant="outline" size="sm">활성화</Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">백그라운드 모니터링</span>
                    <Button variant="outline" size="sm">설정</Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    고급 설정
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">YOLO 모델 버전</span>
                      <span className="text-xs text-blue-600">YOLOv8n-pose</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">모델 캐시</span>
                      <Button variant="outline" size="sm">정리</Button>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">디버그 모드</span>
                      <Button variant="outline" size="sm">비활성화</Button>
                    </div>
                  </div>
                  <hr />
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">데이터 저장</span>
                      <Button variant="outline" size="sm">활성화</Button>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">통계 기간</span>
                      <Button variant="outline" size="sm">30일</Button>
                    </div>
                    <Button variant="destructive" size="sm" className="w-full">
                      모든 데이터 삭제
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Info className="h-5 w-5" />
                    전력 절약 모드 정보
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 text-sm">
                    <div className="bg-green-50 p-3 rounded-lg">
                      <h4 className="font-medium text-green-800 mb-1">적응형 전력 절약</h4>
                      <p className="text-green-700">
                        자세 점수에 따라 분석 주기를 자동 조정합니다. 좋은 자세일 때는 분석 간격을 늘려 배터리를 절약하고,
                        나쁜 자세일 때는 간격을 줄여 빠른 피드백을 제공합니다.
                      </p>
                    </div>
                    <div className="bg-blue-50 p-3 rounded-lg">
                      <h4 className="font-medium text-blue-800 mb-1">백그라운드 모니터링</h4>
                      <p className="text-blue-700">
                        앱이 백그라운드에 있을 때도 주기적으로 자세를 체크합니다.
                        카메라를 간헐적으로만 사용하여 전력 소모를 최소화합니다.
                      </p>
                    </div>
                    <div className="bg-yellow-50 p-3 rounded-lg">
                      <h4 className="font-medium text-yellow-800 mb-1">AI 모델 최적화</h4>
                      <p className="text-yellow-700">
                        YOLOv8n-pose 경량 모델을 사용하여 정확성과 성능의 균형을 맞춥니다.
                        모델은 캐시되어 재사용되므로 네트워크 사용량을 줄입니다.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
            
            {/* 테스트 섹션 */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  🔧 YOLO 모델 테스트
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-4">
                  <Button
                    onClick={async () => {
                      try {
                        const result = await invoke('test_model_status');
                        setTestResults(JSON.stringify(result, null, 2));
                        console.log('모델 상태 테스트 결과:', result);
                      } catch (error) {
                        console.error('모델 상태 테스트 실패:', error);
                        setTestResults(`오류: ${error}`);
                      }
                    }}
                    variant="outline"
                    size="sm"
                  >
                    모델 상태 확인
                  </Button>
                  <Button
                    onClick={async () => {
                      try {
                        await invoke('initialize_pose_model');
                        setTestResults('✅ 모델 초기화 성공!');
                        console.log('모델 초기화 완료');
                      } catch (error) {
                        console.error('모델 초기화 실패:', error);
                        setTestResults(`❌ 모델 초기화 오류: ${error}`);
                      }
                    }}
                    className="bg-green-500 hover:bg-green-600"
                    size="sm"
                  >
                    모델 초기화 테스트
                  </Button>
                </div>
                
                {testResults && (
                  <div className="mt-4 p-4 bg-gray-100 rounded-lg">
                    <h3 className="font-semibold mb-2">테스트 결과:</h3>
                    <pre className="text-sm overflow-auto whitespace-pre-wrap">{testResults}</pre>
                  </div>
                )}
                
                <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <h3 className="font-semibold text-yellow-800 mb-2">📋 확인 방법:</h3>
                  <ul className="text-sm text-yellow-700 space-y-1">
                    <li>1. <strong>"모델 상태 확인"</strong> 버튼을 눌러 현재 모델 로딩 상태를 확인하세요</li>
                    <li>2. <strong>"모델 초기화 테스트"</strong> 버튼을 눌러 YOLO 모델 다운로드 및 초기화를 테스트하세요</li>
                    <li>3. 브라우저 콘솔(F12)에서 더 자세한 로그를 확인할 수 있습니다</li>
                    <li>4. 모델 초기화가 성공하면 <span className="font-semibold">실제 YOLO-pose가 작동중</span>인 것입니다</li>
                    <li>5. 터미널에서도 모델 다운로드 및 초기화 로그를 확인할 수 있습니다</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="about" className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">앱 정보</h2>
                <p className="text-gray-600">Pose Nudge에 대해 알아보세요</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>앱 정보</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="font-medium">버전</span>
                      <span>0.1.0</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium">개발자</span>
                      <span>dduldduck</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium">빌드</span>
                      <span>Tauri + React</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>기능 소개</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-start gap-2">
                      <span className="text-blue-500 mt-1">•</span>
                      <span>실시간 웹캠 기반 자세 분석</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-blue-500 mt-1">•</span>
                      <span>거북목 및 어깨 정렬 감지</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-blue-500 mt-1">•</span>
                      <span>데스크톱 알림을 통한 자세 교정 안내</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-blue-500 mt-1">•</span>
                      <span>자세 점수 및 통계 제공</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-blue-500 mt-1">•</span>
                      <span>개인화된 자세 개선 권장사항</span>
                    </li>
                  </ul>
                </CardContent>
              </Card>

              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle>사용 방법</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div className="space-y-2">
                      <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold">
                        1
                      </div>
                      <h4 className="font-medium">웹캠 연결</h4>
                      <p className="text-gray-600">실시간 모니터링 탭에서 웹캠을 연결하고 권한을 허용하세요.</p>
                    </div>
                    <div className="space-y-2">
                      <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold">
                        2
                      </div>
                      <h4 className="font-medium">모니터링 시작</h4>
                      <p className="text-gray-600">모니터링 스위치를 켜서 실시간 자세 분석을 시작하세요.</p>
                    </div>
                    <div className="space-y-2">
                      <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold">
                        3
                      </div>
                      <h4 className="font-medium">자세 개선</h4>
                      <p className="text-gray-600">알림과 권장사항을 따라 바른 자세를 유지하세요.</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </main>
      
      {/* 알림 시스템 */}
      <NotificationSystem />
    </div>
  );
}

export default App;
