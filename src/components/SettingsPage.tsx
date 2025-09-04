// src/components/SettingsPage.tsx

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Command, open } from '@tauri-apps/plugin-shell';
import { platform } from '@tauri-apps/plugin-os';
import { useTranslation } from 'react-i18next';
// ✨ Tauri API import
import { invoke } from '@tauri-apps/api/core';

const LANGUAGE_KEY = "pose_nudge_language";

// ✨ 감지 설정 관련 Key
const NOTIFICATION_FREQUENCY_KEY = "pose_nudge_notification_frequency";
const TURTLE_NECK_SENSITIVITY_KEY = "pose_nudge_turtle_neck_sensitivity";
const SHOULDER_SENSITIVITY_KEY = "pose_nudge_shoulder_sensitivity";


const CameraSettings = () => {
    const { t } = useTranslation();
    const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
    const [selectedCamera, setSelectedCamera] = useState<string>(() => localStorage.getItem('pose_nudge_camera') || '');
    const videoRef = useRef<HTMLVideoElement>(null);

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

    const openCameraSettings = async () => {
        try {
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

    useEffect(() => {
        getCameras();
    }, []);

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
                 <div className="p-4 bg-yellow-50 border-l-4 border-yellow-400 text-yellow-800">
                    <p><strong>{t('settings.cameraNoticeTitle', '중요 안내:')}</strong> {t('settings.cameraNoticeContent', '현재 이 설정은 카메라 미리보기에만 적용됩니다. 실제 자세 분석은 시스템의 기본 카메라로 동작합니다.')}</p>
                </div>
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

// ✨ 추가된 컴포넌트: 감지 및 알림 설정
const DetectionSettings = () => {
    const { t } = useTranslation();

    // 각 설정에 대한 상태 관리. localStorage에서 초기값 로드, 없으면 '2'(보통)으로 설정
    const [frequency, setFrequency] = useState<string>(() => localStorage.getItem(NOTIFICATION_FREQUENCY_KEY) || '2');
    const [turtleNeckSensitivity, setTurtleNeckSensitivity] = useState<string>(() => localStorage.getItem(TURTLE_NECK_SENSITIVITY_KEY) || '2');
    const [shoulderSensitivity, setShoulderSensitivity] = useState<string>(() => localStorage.getItem(SHOULDER_SENSITIVITY_KEY) || '2');

    // 설정 값이 변경될 때마다 localStorage에 저장하고 백엔드로 전송
    useEffect(() => {
        localStorage.setItem(NOTIFICATION_FREQUENCY_KEY, frequency);
        localStorage.setItem(TURTLE_NECK_SENSITIVITY_KEY, turtleNeckSensitivity);
        localStorage.setItem(SHOULDER_SENSITIVITY_KEY, shoulderSensitivity);

        invoke('set_detection_settings', {
            frequency: parseInt(frequency, 10),
            turtleSensitivity: parseInt(turtleNeckSensitivity, 10),
            shoulderSensitivity: parseInt(shoulderSensitivity, 10),
        }).catch(console.error);
    }, [frequency, turtleNeckSensitivity, shoulderSensitivity]);

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('settings.detectionTitle', '감지 및 알림 설정')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* 알림 빈도 설정 */}
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <span className="font-medium">{t('settings.notificationFrequency', '알림 빈도')}</span>
                      <p className="text-sm text-gray-500">{t('settings.notificationFrequencyDesc', '최근 3번의 감지 중 몇 번 이상 나쁜 자세가 감지되면 알림을 받을지 설정합니다.')}</p>
                    </div>
                    <Select value={frequency} onValueChange={setFrequency}>
                        <SelectTrigger className="w-[250px]">
                            <SelectValue placeholder={t('settings.selectPlaceholder', '단계를 선택하세요')} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="1">{t('settings.frequencyOnce', '1번 (민감)')}</SelectItem>
                            <SelectItem value="2">{t('settings.frequencyTwice', '2번 (보통)')}</SelectItem>
                            <SelectItem value="3">{t('settings.frequencyThrice', '3번 (둔감)')}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                {/* 거북목 감지 강도 설정 */}
                <div className="flex items-center justify-between">
                     <div className="space-y-1">
                        <span className="font-medium">{t('settings.turtleNeckSensitivity', '거북목 감지 강도')}</span>
                         <p className="text-sm text-gray-500">{t('settings.turtleNeckSensitivityDesc', '거북목 자세를 얼마나 엄격하게 감지할지 설정합니다.')}</p>
                    </div>
                    <Select value={turtleNeckSensitivity} onValueChange={setTurtleNeckSensitivity}>
                        <SelectTrigger className="w-[250px]">
                            <SelectValue placeholder={t('settings.selectPlaceholder', '단계를 선택하세요')} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="1">{t('settings.sensitivityLoose', '느슨하게')}</SelectItem>
                            <SelectItem value="2">{t('settings.sensitivityNormal', '보통')}</SelectItem>
                            <SelectItem value="3">{t('settings.sensitivityStrict', '엄격하게')}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                {/* 어깨 정렬 감지 강도 설정 */}
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <span className="font-medium">{t('settings.shoulderSensitivity', '어깨 정렬 감지 강도')}</span>
                        <p className="text-sm text-gray-500">{t('settings.shoulderSensitivityDesc', '어깨 비대칭을 얼마나 엄격하게 감지할지 설정합니다.')}</p>
                    </div>
                    <Select value={shoulderSensitivity} onValueChange={setShoulderSensitivity}>
                        <SelectTrigger className="w-[250px]">
                            <SelectValue placeholder={t('settings.selectPlaceholder', '단계를 선택하세요')} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="1">{t('settings.sensitivityLoose', '느슨하게')}</SelectItem>
                            <SelectItem value="2">{t('settings.sensitivityNormal', '보통')}</SelectItem>
                            <SelectItem value="3">{t('settings.sensitivityStrict', '엄격하게')}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </CardContent>
        </Card>
    );
};


const NotificationSettings = () => {
    const { t } = useTranslation();

    const openNotificationSettings = async () => {
        try {
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
                <CardTitle>{t('settings.notificationTitle', '시스템 알림 설정')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="p-4 bg-blue-50 border-l-4 border-blue-400 text-blue-800">
                    <p>{t('settings.notificationGuide', '알림이 오지 않는 경우, 아래 버튼을 클릭하여 시스템 설정에서 앱의 알림 권한을 허용해주세요.')}</p>
                    <Button onClick={openNotificationSettings} className="mt-2">
                        {t('settings.notificationGoTo', '알림 설정으로 이동')}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
};

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
            {/* ✨ 추가된 컴포넌트 렌더링 */}
            <DetectionSettings />
            <CameraSettings />
            <NotificationSettings />
        </div>
    );
};

export default SettingsPage;