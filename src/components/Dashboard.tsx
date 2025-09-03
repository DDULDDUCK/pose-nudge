import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { 
  Activity, 
  Bell, 
  Settings, 
  //TrendingUp, 
  Clock, 
  Target,
  //Award,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  Sparkles,
  //User,
  LineChart
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  LineChart as RechartsLineChart, 
  CartesianGrid, 
  XAxis, 
  YAxis, 
  Tooltip, 
  Legend, 
  Line 
} from 'recharts';


interface DashboardStats {
  totalSessions: number;
  averagePostureScore: number;
  alertsToday: number;
  sessionTime: number; // 분 단위
  goodPostureTime: number; // 분 단위
}

// 차트용 샘플 데이터
const chartData = [
  { name: '5일 전', score: 65 },
  { name: '4일 전', score: 70 },
  { name: '3일 전', score: 68 },
  { name: '2일 전', score: 78 },
  { name: '어제', score: 72 },
  { name: '오늘', score: 75 },
];


// StatCard 컴포넌트 추가
interface StatCardProps {
  icon: React.ReactNode;
  title: string;
  value: string | number;
  description: string;
  className?: string;
}

const StatCard: React.FC<StatCardProps> = ({ icon, title, value, description, className }) => (
  <Card className={className}>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium">{title}</CardTitle>
      {icon}
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">{value}</div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </CardContent>
  </Card>
);


const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats>({
    totalSessions: 0,
    averagePostureScore: 0,
    alertsToday: 0,
    sessionTime: 0,
    goodPostureTime: 0
  });
  const [recommendations, setRecommendations] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const recs = await invoke<string[]>('get_pose_recommendations');
      setRecommendations(recs);
      
      // 예시 데이터
      setStats({
        totalSessions: 15,
        averagePostureScore: 75,
        alertsToday: 8,
        sessionTime: 240,
        goodPostureTime: 180
      });
      
      setError('');
    } catch (err) {
      console.error('대시보드 데이터 로드 실패:', err);
      setError('대시보드 데이터를 불러올 수 없습니다');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (minutes: number): string => {
    if (minutes < 60) return `${minutes}분`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}시간 ${mins}분`;
  };

  const getScoreColor = (score: number): string => {
    if (score >= 80) return 'text-emerald-500';
    if (score >= 60) return 'text-amber-500';
    return 'text-red-500';
  };
  
  const getScoreRingColor = (score: number): string => {
    if (score >= 80) return 'stroke-emerald-500';
    if (score >= 60) return 'stroke-amber-500';
    return 'stroke-red-500';
  };

  const getMotivationalMessage = (score: number): string => {
    if (score >= 80) return "훌륭해요! 좋은 자세를 계속 유지하세요.";
    if (score >= 60) return "좋은 시도에요! 조금만 더 신경 써볼까요?";
    return "의식적으로 자세를 교정하며 점수를 올려보세요!";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 bg-slate-50 min-h-screen">
      {/* 헤더 */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">대시보드</h1>
          <p className="text-muted-foreground">안녕하세요, 사용자님! 오늘의 자세 현황을 확인해보세요.</p>
        </div>
        <div className="flex items-center gap-2 mt-4 sm:mt-0">
          <Button variant="outline" size="sm" onClick={loadDashboardData} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            새로고침
          </Button>
          <Button variant="outline" size="sm" className="gap-2">
            <Settings className="h-4 w-4" />
            설정
          </Button>
        </div>
      </div>
      
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* 메인 그리드 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 왼쪽: 메인 점수 및 추천 */}
        <div className="lg:col-span-1 space-y-6">
          <Card className="shadow-lg bg-gradient-to-br from-blue-50 to-indigo-100">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5 text-blue-600" />
                평균 자세 점수
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center space-y-4">
              <div className="relative h-48 w-48">
                <svg className="h-full w-full" viewBox="0 0 100 100">
                  <circle
                    className="stroke-current text-gray-200"
                    strokeWidth="10"
                    cx="50"
                    cy="50"
                    r="40"
                    fill="transparent"
                  ></circle>
                  <circle
                    className={`stroke-current ${getScoreRingColor(stats.averagePostureScore)}`}
                    strokeWidth="10"
                    cx="50"
                    cy="50"
                    r="40"
                    fill="transparent"
                    strokeDasharray={2 * Math.PI * 40}
                    strokeDashoffset={2 * Math.PI * 40 * (1 - stats.averagePostureScore / 100)}
                    strokeLinecap="round"
                    transform="rotate(-90 50 50)"
                  ></circle>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={`text-5xl font-bold ${getScoreColor(stats.averagePostureScore)}`}>
                    {stats.averagePostureScore}
                  </span>
                  <span className="text-sm text-muted-foreground">/ 100</span>
                </div>
              </div>
              <p className="text-center text-muted-foreground px-4">
                {getMotivationalMessage(stats.averagePostureScore)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-yellow-500" />
                자세 개선 팁
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {recommendations.map((rec, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-muted-foreground">{rec}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* 오른쪽: 상세 통계 */}
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <StatCard 
              icon={<Activity className="h-4 w-4 text-muted-foreground" />}
              title="총 세션"
              value={stats.totalSessions}
              description="지금까지의 누적 세션"
            />
            <StatCard 
              icon={<Bell className="h-4 w-4 text-muted-foreground" />}
              title="오늘 알림"
              value={stats.alertsToday}
              description="자세 교정 알림 횟수"
            />
            <StatCard 
              icon={<Clock className="h-4 w-4 text-muted-foreground" />}
              title="총 사용 시간"
              value={formatTime(stats.sessionTime)}
              description="오늘의 총 세션 시간"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LineChart className="h-5 w-5" />
                자세 점수 추이
              </CardTitle>
              <CardDescription>최근 6일간의 자세 점수 변화입니다.</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <RechartsLineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" stroke="#888888" fontSize={12} />
                  <YAxis stroke="#888888" fontSize={12} domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgba(255, 255, 255, 0.8)",
                      border: "1px solid #ccc",
                      borderRadius: "0.5rem",
                    }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="score" stroke="#10b981" strokeWidth={2} name="자세 점수" />
                </RechartsLineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
                <CardTitle>오늘의 자세 분석</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div>
                    <div className="flex justify-between mb-1">
                        <span className="text-sm font-medium text-emerald-600">좋은 자세</span>
                        <span className="text-sm font-medium text-emerald-600">{formatTime(stats.goodPostureTime)}</span>
                    </div>
                    <Progress value={(stats.goodPostureTime / stats.sessionTime) * 100} className="[&>div]:bg-emerald-500" />
                </div>
                <div>
                    <div className="flex justify-between mb-1">
                        <span className="text-sm font-medium text-red-600">개선 필요</span>
                        <span className="text-sm font-medium text-red-600">{formatTime(stats.sessionTime - stats.goodPostureTime)}</span>
                    </div>
                    <Progress value={((stats.sessionTime - stats.goodPostureTime) / stats.sessionTime) * 100} className="[&>div]:bg-red-500" />
                </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;