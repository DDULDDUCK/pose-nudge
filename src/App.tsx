// src/App.tsx

import { useState, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Dashboard from '@/components/Dashboard';
import WebcamCapture from '@/components/WebcamCapture';
import SettingsPage from '@/components/SettingsPage'; // 새로 만든 설정 페이지 가져오기
import {
  LayoutDashboard,
  Camera,
  Settings,
  Info,
  Heart,
} from 'lucide-react';
import './App.css';
import './i18n';
import { useTranslation } from 'react-i18next';
// --- 페이지 컴포넌트 정의 ---

// 정보 페이지 컴포넌트
const AboutPage = () => {
  const { t } = useTranslation();
  const [currentVersion, setCurrentVersion] = useState<string>(t('about.loading', '로딩 중...'));
  const [updateStatus, setUpdateStatus] = useState<string>('');
  const [checkingUpdate, setCheckingUpdate] = useState<boolean>(false);

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const version = await getVersion();
        setCurrentVersion(version);
      } catch (error) {
        console.error('버전 가져오기 실패:', error);
        setCurrentVersion(t('about.unknown', '알 수 없음'));
      }
    };
    fetchVersion();
  }, [t]);

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateStatus(t('about.checkingUpdate', '업데이트 확인 중...'));
    try {
      const update = await check();
      if (update) {
        setUpdateStatus(t('about.updateAvailable', '새로운 버전 {{version}}이 있습니다. ({{date}})', { version: update.version, date: update.date }));
      } else {
        setUpdateStatus(t('about.upToDate', '현재 최신 버전입니다.'));
      }
    } catch (error) {
      console.error('업데이트 확인 실패:', error);
      setUpdateStatus(t('about.updateFailed', '업데이트 확인 실패'));
    } finally {
      setCheckingUpdate(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>{t('about.appInfo', '앱 정보')}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between"><span className="font-medium">{t('about.version', '버전')}</span><span>{currentVersion}</span></div>
              <div className="flex justify-between"><span className="font-medium">{t('about.developer', '개발자')}</span><span>dduldduck</span></div>
              <div className="flex justify-between"><span className="font-medium">{t('about.build', '빌드')}</span><span>Tauri + React</span></div>
            </div>
            <div className="pt-4 border-t">
              <Button onClick={handleCheckUpdate} disabled={checkingUpdate} className="w-full">
                {checkingUpdate ? t('about.checking', '확인 중...') : t('about.checkUpdate', '업데이트 확인')}
              </Button>
              {updateStatus && <p className="mt-2 text-sm text-center">{updateStatus}</p>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t('about.features', '기능 소개')}</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2"><span className="text-blue-500 mt-1">•</span><span>{t('about.feature1', '실시간 웹캠 기반 자세 분석')}</span></li>
              <li className="flex items-start gap-2"><span className="text-blue-500 mt-1">•</span><span>{t('about.feature2', '거북목 및 어깨 정렬 감지')}</span></li>
              <li className="flex items-start gap-2"><span className="text-blue-500 mt-1">•</span><span>{t('about.feature3', '데스크톱 알림을 통한 자세 교정 안내')}</span></li>
              <li className="flex items-start gap-2"><span className="text-blue-500 mt-1">•</span><span>{t('about.feature4', '자세 점수 및 통계 제공')}</span></li>
              <li className="flex items-start gap-2"><span className="text-blue-500 mt-1">•</span><span>{t('about.feature5', '개인화된 자세 개선 권장사항')}</span></li>
            </ul>
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader><CardTitle>{t('about.usage', '사용 방법')}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="space-y-2">
                <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold">1</div>
                <h4 className="font-medium">{t('about.step1', '웹캠 연결')}</h4>
                <p className="text-gray-600">{t('about.step1Desc', '실시간 모니터링 탭에서 웹캠을 연결하고 권한을 허용하세요.')}</p>
              </div>
              <div className="space-y-2">
                <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold">2</div>
                <h4 className="font-medium">{t('about.step2', '모니터링 시작')}</h4>
                <p className="text-gray-600">{t('about.step2Desc', '모니터링 스위치를 켜서 실시간 자세 분석을 시작하세요.')}</p>
              </div>
              <div className="space-y-2">
                <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold">3</div>
                <h4 className="font-medium">{t('about.step3', '자세 개선')}</h4>
                <p className="text-gray-600">{t('about.step3Desc', '알림과 권장사항을 따라 바른 자세를 유지하세요.')}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};


// --- 네비게이션 아이템 타입 정의 ---
type NavItem = {
  id: string;
  label: string;
  icon: React.ElementType;
  component: React.FC;
};

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'dashboard', icon: LayoutDashboard, component: Dashboard },
  { id: 'monitoring', label: 'monitoring', icon: Camera, component: WebcamCapture },
  { id: 'settings', label: 'settings', icon: Settings, component: SettingsPage },
  { id: 'about', label: 'about', icon: Info, component: AboutPage },
];


function App() {
  const { t } = useTranslation();
  const [activeComponentId, setActiveComponentId] = useState('dashboard');

  const ActiveComponent = navItems.find(item => item.id === activeComponentId)?.component || Dashboard;
  const activeLabel = t(`nav.${activeComponentId}`, activeComponentId);

  return (
      <div className="flex h-screen bg-background text-foreground">
      {/* 사이드바 */}
      <aside className="w-64 flex-shrink-0 bg-card border-r border-border flex flex-col">
        <div className="h-16 flex items-center justify-center px-6 border-b">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt={t('app.logoAlt', 'Pose Nudge Logo')}
              className="w-12 h-12 rounded-lg object-cover"
            />
            <h1 className="text-2xl font-bold">{t('app.title', 'Pose Nudge')}</h1>
          </div>
        </div>
        <nav className="flex-1 px-4 py-6 space-y-2">
          {navItems.map((item) => (
            <Button
              key={item.id}
              variant={activeComponentId === item.id ? 'secondary' : 'ghost'}
              className="w-full justify-start gap-3 text-base"
              onClick={() => setActiveComponentId(item.id)}
            >
              <item.icon className="w-5 h-5" />
              {t(`nav.${item.id}`, item.label)}
            </Button>
          ))}
        </nav>
        <div className="px-4 py-4 border-t">
          <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
            <Heart className="w-4 h-4 text-red-500" />
            <span>{t('app.slogan', '건강한 자세로 더 나은 삶을')}</span>
          </div>
        </div>
      </aside>

      {/* 메인 컨텐츠 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-card border-b border-border flex items-center px-8">
          <h2 className="text-2xl font-bold">{activeLabel}</h2>
        </header>
        <main className="flex-1 overflow-y-auto p-8">
          <ActiveComponent />
        </main>
      </div>

    </div>
  );
}

export default App;