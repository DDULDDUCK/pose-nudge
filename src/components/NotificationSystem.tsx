import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { X, Bell } from 'lucide-react';

interface NotificationProps {
  message: string;
  onClose: () => void;
}

const NotificationItem: React.FC<NotificationProps> = ({ message, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 5000); // 5초 후 자동 사라짐

    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <Alert className="mb-2 bg-orange-50 border-orange-200">
      <Bell className="h-4 w-4 text-orange-600" />
      <AlertDescription className="flex items-center justify-between">
        <span className="text-orange-800">{message}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-auto p-1 text-orange-600 hover:text-orange-800"
        >
          <X className="h-3 w-3" />
        </Button>
      </AlertDescription>
    </Alert>
  );
};

const NotificationSystem: React.FC = () => {
  const [notifications, setNotifications] = useState<string[]>([]);

  useEffect(() => {
    const handler = (e: CustomEvent<string>) => {
      setNotifications(prev => [...prev, e.detail]);
    };
    window.addEventListener('pose-nudge-toast', handler as EventListener);
    return () => window.removeEventListener('pose-nudge-toast', handler as EventListener);
  }, []);

  const checkForAlerts = async () => {
    try {
      const alerts = await invoke<string[]>('get_alert_messages');
      if (alerts.length > 0) {
        setNotifications(prev => [...prev, ...alerts]);
        
        // 브라우저 알림 권한이 있다면 브라우저 알림도 표시
        if (Notification.permission === 'granted') {
          alerts.forEach(alert => {
            new Notification('자세 교정 알림', {
              body: alert,
              icon: '/logo.png'
            });
          });
        }
      }
    } catch (error) {
      console.error('알림 확인 중 오류:', error);
    }
  };

  const requestNotificationPermission = async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        console.log('브라우저 알림 권한이 허용되었습니다');
      }
    }
  };

  const removeNotification = (index: number) => {
    setNotifications(prev => prev.filter((_, i) => i !== index));
  };

  useEffect(() => {
    // 브라우저 알림 권한 요청
    requestNotificationPermission();

    // 3초마다 알림 확인
    const interval = setInterval(checkForAlerts, 3000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed top-4 right-4 z-50 w-80 max-h-96 overflow-y-auto">
      {notifications.map((notification, index) => (
        <NotificationItem
          key={index}
          message={notification}
          onClose={() => removeNotification(index)}
        />
      ))}
    </div>
  );
};

export default NotificationSystem;