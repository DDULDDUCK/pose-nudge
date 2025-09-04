// src/components/SettingsPage.tsx

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
// 언어 설정 유지용
import { Command, open } from '@tauri-apps/plugin-shell';
import { platform } from '@tauri-apps/plugin-os';

const LANGUAGE_KEY = "pose_nudge_language";
// 카메라 설정 컴포넌트 (수정됨)
import { useTranslation } from 'react-i18next';

const CameraSettings = () => {
    const { t } = useTranslation();
    const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
    const [selectedCamera, setSelectedCamera] = useState<string>(() => localStorage.getItem('pose_nudge_camera') || '');
    const videoRef = useRef<HTMLVideoElement>(null);

    // 카메라 장치 목록을 가져오는 함수
    const getCameras = async () => {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(
                device => device.kind === 'videoinput' && device.deviceId
            );
            setCameras(videoDevices);
            if (videoDevices.length > 0 && !selectedCamera) {
                setSelectedCamera(videoDevices[0].deviceId);
            }
        } catch (error) {
            console.error("카메라 목록을 가져오는 중 오류 발생:", error);
        }
    };

    // 시스템 카메라 설정으로 이동하는 함수
    const openCameraSettings = async () => {
        try {
            // ⬇️ platform()은 비동기 함수이므로 await를 사용해야 합니다.
            const osPlatform = await platform();

            if (osPlatform === 'macos') {
                const command = Command.create('open-settings', [
                    "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera"
                ]);
                await command.execute();
            } else if (osPlatform === 'windows') {
                await open('ms-settings:privacy-webcam');
            } else {
                alert('시스템 설정 > 개인 정보 보호 및 보안 > 카메라에서 앱 권한을 직접 허용해주세요.');
            }
        } catch (error) {
             console.error("설정 창을 여는 중 오류 발생:", error);
             alert("설정 창을 열 수 없습니다. 수동으로 시스템 설정 > 개인 정보 보호 및 보안 > 카메라로 이동하여 권한을 확인해주세요.");
        }
    };

    // 컴포넌트가 마운트될 때 카메라 목록을 가져옵니다.
    useEffect(() => {
        getCameras();
    }, []);

    // 선택된 카메라가 변경되면 미리보기 스트림을 설정합니다.
    useEffect(() => {
        if (selectedCamera && videoRef.current) {
            let stream: MediaStream | null = null;

            const startStream = async () => {
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: { deviceId: { exact: selectedCamera } },
                    });
                    if (videoRef.current) {
                        videoRef.current.srcObject = stream;
                    }
                } catch (error) {
                    console.error("카메라 스트림 시작 중 오류 (권한 필요):", error);
                    if (videoRef.current) {
                        videoRef.current.srcObject = null;
                    }
                }
            };
            startStream();

            return () => {
                if (stream) {
                    stream.getTracks().forEach(track => track.stop());
                }
            };
        }
    }, [selectedCamera]);

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('settings.cameraTitle', '카메라 설정')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="p-4 bg-blue-50 border-l-4 border-blue-400 text-blue-800">
                    <p>{t('settings.cameraGuide', '카메라가 작동하지 않는 경우, 아래 버튼을 클릭하여 시스템 설정에서 앱의 카메라 접근 권한을 허용해주세요.')}</p>
                    <Button onClick={openCameraSettings} className="mt-2">
                        {t('settings.cameraGoTo', '카메라 설정으로 이동')}
                    </Button>
                </div>

                <div className="flex items-center justify-between">
                    <span className="font-medium">{t('settings.cameraSelect', '사용할 카메라')}</span>
                    <Select value={selectedCamera} onValueChange={(value) => {
                        setSelectedCamera(value);
                        localStorage.setItem('pose_nudge_camera', value);
                    }} disabled={cameras.length === 0}>
                        <SelectTrigger className="w-[250px]">
                            <SelectValue placeholder={cameras.length === 0 ? t('settings.cameraNone', '사용 가능한 카메라 없음') : t('settings.cameraSelectPlaceholder', '카메라를 선택하세요')} />
                        </SelectTrigger>
                        <SelectContent>
                            {cameras.map((camera, index) => (
                                <SelectItem key={camera.deviceId} value={camera.deviceId}>
                                    {camera.label || t('settings.cameraDefault', `카메라 ${index + 1}`)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="w-full aspect-video bg-gray-900 rounded-md overflow-hidden flex items-center justify-center text-white relative">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  {cameras.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <p>{t('settings.cameraNotFound', '카메라를 찾을 수 없습니다.')}</p>
                    </div>
                  )}
                </div>
            </CardContent>
        </Card>
    );
};

// 알림 설정 컴포넌트 (수정됨)
const NotificationSettings = () => {
    const { t } = useTranslation();
    const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(true);

    // 시스템 알림 설정으로 이동하는 함수
    const openNotificationSettings = async () => {
        try {
            // ⬇️ platform()은 비동기 함수이므로 await를 사용해야 합니다.
            const osPlatform = await platform();

            if (osPlatform === 'macos') {
                const command = Command.create('open-settings', [
                    "x-apple.systempreferences:com.apple.preference.notifications"
                ]);
                await command.execute();
            } else if (osPlatform === 'windows') {
                await open('ms-settings:notifications');
            } else {
                alert('시스템 설정 > 알림에서 앱의 알림 권한을 직접 허용해주세요.');
            }
        } catch (error) {
            console.error("알림 설정 창을 여는 중 오류 발생:", error);
            alert("설정 창을 열 수 없습니다. 수동으로 시스템 설정 > 알림으로 이동하여 권한을 확인해주세요.");
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('settings.notificationTitle', '알림 설정')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="p-4 bg-blue-50 border-l-4 border-blue-400 text-blue-800">
                    <p>{t('settings.notificationGuide', '알림이 오지 않는 경우, 아래 버튼을 클릭하여 시스템 설정에서 앱의 알림 권한을 허용해주세요.')}</p>
                    <Button onClick={openNotificationSettings} className="mt-2">
                        {t('settings.notificationGoTo', '알림 설정으로 이동')}
                    </Button>
                </div>

                <div className="flex items-center justify-between">
                    <span className="font-medium">{t('settings.notificationSwitch', '자세 교정 알림')}</span>
                    <Switch
                        checked={notificationsEnabled}
                        onCheckedChange={setNotificationsEnabled}
                    />
                </div>
            </CardContent>
        </Card>
    );
};


// 메인 설정 페이지 컴포넌트

const LanguageSettings = () => {
    const { i18n, t } = useTranslation();
    const [lang, setLang] = useState(() => localStorage.getItem(LANGUAGE_KEY) || i18n.language);

    const handleChange = (value: string) => {
        i18n.changeLanguage(value);
        setLang(value);
        localStorage.setItem(LANGUAGE_KEY, value);
    };

    useEffect(() => {
        const savedLang = localStorage.getItem(LANGUAGE_KEY);
        if (savedLang && savedLang !== i18n.language) {
            i18n.changeLanguage(savedLang);
            setLang(savedLang);
        }
    }, [i18n]);

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('settings.languageTitle', '언어 설정')}</CardTitle>
            </CardHeader>
            <CardContent>
                <Select value={lang} onValueChange={handleChange}>
                    <SelectTrigger className="w-[250px]">
                        <SelectValue placeholder={t('settings.languagePlaceholder', '언어를 선택하세요')} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="ko">{t('settings.languageKorean', '한국어')}</SelectItem>
                        <SelectItem value="en">{t('settings.languageEnglish', 'English')}</SelectItem>
                    </SelectContent>
                </Select>
            </CardContent>
        </Card>
    );
};

const SettingsPage = () => {
    return (
        <div className="space-y-6">
            <LanguageSettings />
            <CameraSettings />
            <NotificationSettings />
        </div>
    );
};

export default SettingsPage;