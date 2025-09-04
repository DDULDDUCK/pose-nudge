// src/components/Dashboard.tsx

import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getDb } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Activity, Bell, Clock, Target, AlertCircle, CheckCircle, RefreshCw, Sparkles, LineChart } from 'lucide-react';
import { ResponsiveContainer, LineChart as RechartsLineChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Line } from 'recharts';

// 컴포넌트 내부에서 사용할 타입 정의
interface DashboardStats {
  total_sessions: number;
  average_posture_score: number;
  alerts_today: number;
  session_time: number;
  good_posture_time: number;
}

interface DailyScore {
  name: string;
  score: number;
}

// StatCard 컴포넌트
const StatCard: React.FC<{ icon: React.ReactNode; title: string; value: string | number; description: string; }> = ({ icon, title, value, description }) => (
  <Card>
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
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [chartData, setChartData] = useState<DailyScore[]>([]);
  const [recommendations, setRecommendations] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setError('');
      const db = await getDb();

      const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
      const sixDaysAgo = Math.floor(new Date(new Date().setDate(new Date().getDate() - 5)).setHours(0,0,0,0) / 1000);

      const [statsResult, chartResult, recs] = await Promise.all([
        db.select<any[]>(`
            SELECT
                (SELECT COUNT(DISTINCT date(timestamp, 'unixepoch')) FROM posture_log) as total_sessions,
                AVG(CASE WHEN timestamp >= $1 THEN score ELSE NULL END) as average_posture_score,
                SUM(CASE WHEN (is_turtle_neck = 1 OR is_shoulder_misaligned = 1) AND timestamp >= $1 THEN 1 ELSE 0 END) as alerts_today,
                COUNT(CASE WHEN timestamp >= $1 THEN 1 ELSE NULL END) as records_today,
                SUM(CASE WHEN score >= 80 AND timestamp >= $1 THEN 1 ELSE 0 END) as good_records_today
            FROM posture_log
        `, [todayStart]),
        db.select<DailyScore[]>(`
            SELECT
                strftime('%m-%d', datetime(timestamp, 'unixepoch', 'localtime')) as name,
                ROUND(AVG(score)) as score
            FROM posture_log
            WHERE timestamp >= $1
            GROUP BY name
            ORDER BY name ASC
            LIMIT 6
        `, [sixDaysAgo]),
        invoke<string[]>('get_pose_recommendations')
      ]);

      const rawStats = statsResult[0] || {};
      setStats({
          total_sessions: rawStats.total_sessions || 0,
          average_posture_score: Math.round(rawStats.average_posture_score || 0),
          alerts_today: rawStats.alerts_today || 0,
          session_time: Math.floor(((rawStats.records_today || 0) * 3) / 60),
          good_posture_time: Math.floor(((rawStats.good_records_today || 0) * 3) / 60)
      });

      setChartData(chartResult);
      setRecommendations(recs);

    } catch (err) {
      console.error('대시보드 데이터 로드 실패:', err);
      setError('대시보드 데이터를 불러올 수 없습니다. 데이터가 아직 없거나, 데이터베이스 연결에 실패했습니다.');
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
      <div className="flex items-center justify-center h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 컨트롤 버튼 */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={loadDashboardData} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          새로고침
        </Button>
      </div>
      
      {error && !stats && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* 메인 그리드 */}
      {stats ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 왼쪽: 메인 점수 및 추천 */}
          <div className="lg:col-span-1 space-y-6">
            <Card className="shadow-lg bg-gradient-to-br from-blue-50 to-indigo-100">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-blue-600" />
                  오늘의 평균 자세 점수
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center justify-center space-y-4">
                <div className="relative h-48 w-48">
                  <svg className="h-full w-full" viewBox="0 0 100 100">
                    <circle className="stroke-current text-gray-200" strokeWidth="10" cx="50" cy="50" r="40" fill="transparent"></circle>
                    <circle
                      className={`stroke-current ${getScoreRingColor(stats.average_posture_score)} transition-all duration-500`}
                      strokeWidth="10" cx="50" cy="50" r="40" fill="transparent"
                      strokeDasharray={2 * Math.PI * 40}
                      strokeDashoffset={2 * Math.PI * 40 * (1 - (stats.average_posture_score || 0) / 100)}
                      strokeLinecap="round" transform="rotate(-90 50 50)"
                    ></circle>
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className={`text-5xl font-bold ${getScoreColor(stats.average_posture_score)}`}>
                      {stats.average_posture_score}
                    </span>
                    <span className="text-sm text-muted-foreground">/ 100</span>
                  </div>
                </div>
                <p className="text-center text-muted-foreground px-4">
                  {getMotivationalMessage(stats.average_posture_score)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-yellow-500" /> 자세 개선 팁</CardTitle></CardHeader>
              <CardContent>
                {recommendations.length > 0 ? (
                  <ul className="space-y-3">
                    {recommendations.map((rec, index) => (
                      <li key={index} className="flex items-start gap-3">
                        <CheckCircle className="h-5 w-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                        <span className="text-sm text-muted-foreground">{rec}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-center text-muted-foreground py-4">데이터를 분석하여 맞춤 팁을 제공해 드립니다.</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* 오른쪽: 상세 통계 */}
          <div className="lg:col-span-2 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <StatCard icon={<Activity />} title="총 세션" value={stats.total_sessions} description="지금까지의 누적 세션" />
              <StatCard icon={<Bell />} title="오늘 알림" value={stats.alerts_today} description="자세 교정 알림 횟수" />
              <StatCard icon={<Clock />} title="총 사용 시간" value={formatTime(stats.session_time)} description="오늘의 총 세션 시간" />
            </div>

            <Card>
              <CardHeader>
                  <CardTitle className="flex items-center gap-2"><LineChart className="h-5 w-5" /> 자세 점수 추이</CardTitle>
                  <CardDescription>최근 6일간의 자세 점수 변화입니다.</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <RechartsLineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" stroke="#888888" fontSize={12} />
                    <YAxis stroke="#888888" fontSize={12} domain={[0, 100]} />
                    <Tooltip contentStyle={{ backgroundColor: "rgba(255, 255, 255, 0.8)", border: "1px solid #ccc", borderRadius: "0.5rem", }} />
                    <Legend />
                    <Line type="monotone" dataKey="score" stroke="#10b981" strokeWidth={2} name="자세 점수" />
                  </RechartsLineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader><CardTitle>오늘의 자세 분석</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                  <div>
                      <div className="flex justify-between mb-1">
                          <span className="text-sm font-medium text-emerald-600">좋은 자세</span>
                          <span className="text-sm font-medium text-emerald-600">{formatTime(stats.good_posture_time)}</span>
                      </div>
                      <Progress value={stats.session_time > 0 ? (stats.good_posture_time / stats.session_time) * 100 : 0} className="[&>div]:bg-emerald-500" />
                  </div>
                  <div>
                      <div className="flex justify-between mb-1">
                          <span className="text-sm font-medium text-red-600">개선 필요</span>
                          <span className="text-sm font-medium text-red-600">{formatTime(stats.session_time - stats.good_posture_time)}</span>
                      </div>
                      <Progress value={stats.session_time > 0 ? ((stats.session_time - stats.good_posture_time) / stats.session_time) * 100 : 0} className="[&>div]:bg-red-500" />
                  </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        !error && (
            <div className="text-center py-20">
                <p className="text-muted-foreground">대시보드 데이터를 불러오는 중이거나, 표시할 데이터가 없습니다.</p>
            </div>
        )
      )}
    </div>
  );
};

export default Dashboard;