// src/App.tsx

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Dashboard from '@/components/Dashboard';
import WebcamCapture from '@/components/WebcamCapture';
import NotificationSystem from '@/components/NotificationSystem';
import SettingsPage from '@/components/SettingsPage'; // 새로 만든 설정 페이지 가져오기
import {
  LayoutDashboard,
  Camera,
  Settings,
  Info,
  Monitor,
  Heart,
} from 'lucide-react';
import './App.css';

// --- 페이지 컴포넌트 정의 ---

// 정보 페이지 컴포넌트 (기존 코드와 동일)
const AboutPage = () => (
    <div className="space-y-6">
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card>
        <CardHeader><CardTitle>앱 정보</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2"><div className="flex justify-between"><span className="font-medium">버전</span><span>0.1.0</span></div><div className="flex justify-between"><span className="font-medium">개발자</span><span>dduldduck</span></div><div className="flex justify-between"><span className="font-medium">빌드</span><span>Tauri + React</span></div></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>기능 소개</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2"><span className="text-blue-500 mt-1">•</span><span>실시간 웹캠 기반 자세 분석</span></li>
            <li className="flex items-start gap-2"><span className="text-blue-500 mt-1">•</span><span>거북목 및 어깨 정렬 감지</span></li>
            <li className="flex items-start gap-2"><span className="text-blue-500 mt-1">•</span><span>데스크톱 알림을 통한 자세 교정 안내</span></li>
            <li className="flex items-start gap-2"><span className="text-blue-500 mt-1">•</span><span>자세 점수 및 통계 제공</span></li>
            <li className="flex items-start gap-2"><span className="text-blue-500 mt-1">•</span><span>개인화된 자세 개선 권장사항</span></li>
          </ul>
        </CardContent>
      </Card>
      <Card className="md:col-span-2">
        <CardHeader><CardTitle>사용 방법</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="space-y-2"><div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold">1</div><h4 className="font-medium">웹캠 연결</h4><p className="text-gray-600">실시간 모니터링 탭에서 웹캠을 연결하고 권한을 허용하세요.</p></div>
            <div className="space-y-2"><div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold">2</div><h4 className="font-medium">모니터링 시작</h4><p className="text-gray-600">모니터링 스위치를 켜서 실시간 자세 분석을 시작하세요.</p></div>
            <div className="space-y-2"><div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold">3</div><h4 className="font-medium">자세 개선</h4><p className="text-gray-600">알림과 권장사항을 따라 바른 자세를 유지하세요.</p></div>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
);


// --- 네비게이션 아이템 타입 정의 ---
type NavItem = {
  id: string;
  label: string;
  icon: React.ElementType;
  component: React.FC;
};

const navItems: NavItem[] = [
  { id: 'dashboard', label: '대시보드', icon: LayoutDashboard, component: Dashboard },
  { id: 'monitoring', label: '실시간 모니터링', icon: Camera, component: WebcamCapture },
  { id: 'settings', label: '설정', icon: Settings, component: SettingsPage }, // 컴포넌트 교체
  { id: 'about', label: '정보', icon: Info, component: AboutPage },
];


function App() {
  const [activeComponentId, setActiveComponentId] = useState('dashboard');

  const ActiveComponent = navItems.find(item => item.id === activeComponentId)?.component || Dashboard;
  const activeLabel = navItems.find(item => item.id === activeComponentId)?.label || '대시보드';

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900">
      {/* 사이드바 (기존 코드와 동일) */}
      <aside className="w-64 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col">
        <div className="h-16 flex items-center justify-center px-6 border-b">
            <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="Pose Nudge Logo"
              className="w-12 h-12 rounded-lg object-cover"
            />
            <h1 className="text-2xl font-bold">Pose Nudge</h1>
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
              {item.label}
            </Button>
          ))}
        </nav>
        <div className="px-4 py-4 border-t">
          <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
            <Heart className="w-4 h-4 text-red-500" />
            <span>건강한 자세로 더 나은 삶을</span>
          </div>
        </div>
      </aside>

      {/* 메인 컨텐츠 (기존 코드와 동일) */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-white border-b flex items-center px-8">
          <h2 className="text-2xl font-bold">{activeLabel}</h2>
        </header>
        <main className="flex-1 overflow-y-auto p-8">
          <ActiveComponent />
        </main>
      </div>

      {/* 알림 시스템 (전역, 기존 코드와 동일) */}
      <NotificationSystem />
    </div>
  );
}

export default App;