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
import { useTranslation } from 'react-i18next';
// 컴포넌트 내부에서 사용할 타입 정의
interface DashboardStats {
  total_sessions: number;
  average_posture_score: number;
  detection_count_today: number;
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
  const { t } = useTranslation();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [chartData, setChartData] = useState<DailyScore[]>([]);
  const recommendations = [
    "tip1",
    "tip2",
    "tip3",
    "tip4",
    "tip5"
  ];
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

      const [statsResult, chartResult] = await Promise.all([
        db.select<any[]>(`
            SELECT
                (SELECT COUNT(DISTINCT date(timestamp, 'unixepoch')) FROM posture_log) as total_sessions,
                AVG(CASE WHEN timestamp >= $1 THEN score ELSE NULL END) as average_posture_score,
                SUM(CASE WHEN (is_turtle_neck = 1 OR is_shoulder_misaligned = 1) AND timestamp >= $1 THEN 1 ELSE 0 END) as detection_count_today,
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
          detection_count_today: rawStats.detection_count_today || 0,
          session_time: Math.floor(((rawStats.records_today || 0) * 3) / 60),
          good_posture_time: Math.floor(((rawStats.good_records_today || 0) * 3) / 60)
      });

      setChartData(chartResult);
      // setRecommendations(recs); // 더 이상 백엔드에서 받아오지 않음

    } catch (err) {
      console.error('대시보드 데이터 로드 실패:', err);
      setError(t('dashboard.loadingError'));
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (minutes: number): string => {
    if (minutes < 60) return t('dashboard.timeFormat.minutes', { count: minutes });
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return t('dashboard.timeFormat.hoursMinutes', { hours, minutes: mins });
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
    if (score >= 80) return t('dashboard.motivation.excellent');
    if (score >= 60) return t('dashboard.motivation.good');
    return t('dashboard.motivation.bad');
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
          {t('dashboard.refresh')}
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
                  {t('dashboard.scoreTitle')}
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
                    <span className="text-sm text-muted-foreground">{t('dashboard.scoreUnit')}</span>
                  </div>
                </div>
                <p className="text-center text-muted-foreground px-4">
                  {getMotivationalMessage(stats.average_posture_score)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-yellow-500" /> {t('dashboard.tipsTitle')}</CardTitle></CardHeader>
              <CardContent>
                {recommendations.length > 0 ? (
                  <ul className="space-y-3">
                    {recommendations.map((rec, index) => (
                      <li key={index} className="flex items-start gap-3">
                        <CheckCircle className="h-5 w-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                        <span className="text-sm text-muted-foreground">{t(`dashboard.tips.${rec}`, rec)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-center text-muted-foreground py-4">{t('dashboard.noTips')}</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* 오른쪽: 상세 통계 */}
          <div className="lg:col-span-2 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <StatCard icon={<Activity />} title={t('dashboard.stats.totalSessions')} value={stats.total_sessions} description={t('dashboard.stats.totalSessionsDesc')} />
              <StatCard icon={<Bell />} title={t('dashboard.stats.todayDetectionCount')} value={stats.detection_count_today} description={t('dashboard.stats.todayDetectionCountDesc')} />
              <StatCard icon={<Clock />} title={t('dashboard.stats.totalTime')} value={formatTime(stats.session_time)} description={t('dashboard.stats.totalTimeDesc')} />
            </div>

            <Card>
              <CardHeader>
                  <CardTitle className="flex items-center gap-2"><LineChart className="h-5 w-5" /> {t('dashboard.chartTitle')}</CardTitle>
                  <CardDescription>{t('dashboard.chartDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <RechartsLineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" stroke="#888888" fontSize={12} />
                    <YAxis stroke="#888888" fontSize={12} domain={[0, 100]} />
                    <Tooltip contentStyle={{ backgroundColor: "rgba(255, 255, 255, 0.8)", border: "1px solid #ccc", borderRadius: "0.5rem", }} />
                    <Legend />
                    <Line type="monotone" dataKey="score" stroke="#10b981" strokeWidth={2} name={t('dashboard.chartLegend')} />
                  </RechartsLineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader><CardTitle>{t('dashboard.analysisTitle')}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                  <div>
                      <div className="flex justify-between mb-1">
                          <span className="text-sm font-medium text-emerald-600">{t('dashboard.goodPosture')}</span>
                          <span className="text-sm font-medium text-emerald-600">{formatTime(stats.good_posture_time)}</span>
                      </div>
                      <Progress value={stats.session_time > 0 ? (stats.good_posture_time / stats.session_time) * 100 : 0} className="[&>div]:bg-emerald-500" />
                  </div>
                  <div>
                      <div className="flex justify-between mb-1">
                          <span className="text-sm font-medium text-red-600">{t('dashboard.badPosture')}</span>
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
                <p className="text-muted-foreground">{t('dashboard.noData')}</p>
            </div>
        )
      )}
    </div>
  );
};

export default Dashboard;