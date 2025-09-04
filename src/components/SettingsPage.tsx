import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Command, open } from '@tauri-apps/plugin-shell';
import { platform } from '@tauri-apps/plugin-os';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';

// --- LocalStorage Keys ---
const LANGUAGE_KEY = "pose_nudge_language";
const NOTIFICATION_FREQUENCY_KEY = "pose_nudge_notification_frequency";
const TURTLE_NECK_SENSITIVITY_KEY = "pose_nudge_turtle_neck_sensitivity";
const SHOULDER_SENSITIVITY_KEY = "pose_nudge_shoulder_sensitivity";
const CAMERA_INDEX_KEY = "pose_nudge_camera_index";
// ✨ 모니터링 주기 저장을 위한 키 추가
const MONITORING_INTERVAL_KEY = "pose_nudge_monitoring_interval";

// --- Type Definitions ---
interface CameraDetail {
    index: number;
    name: string;
}

// --- Components ---

const CameraSettings = () => {
    const { t } = useTranslation();
    const [cameras, setCameras] = useState<CameraDetail[]>([]);
    const [selectedCameraIndex, setSelectedCameraIndex] = useState<string>(
        () => localStorage.getItem(CAMERA_INDEX_KEY) || '0'
    );

    useEffect(() => {
        const getCamerasFromBackend = async () => {
            try {
                const availableCameras = await invoke<CameraDetail[]>('get_available_cameras');
                setCameras(availableCameras);

                const savedIndex = localStorage.getItem(CAMERA_INDEX_KEY) || '0';
                if (!availableCameras.some(cam => cam.index.toString() === savedIndex)) {
                    const defaultIndex = availableCameras.length > 0 ? availableCameras[0].index.toString() : '0';
                    setSelectedCameraIndex(defaultIndex);
                    localStorage.setItem(CAMERA_INDEX_KEY, defaultIndex);
                }

            } catch (error) {
                console.error("백엔드로부터 카메라 목록을 가져오는 중 오류 발생:", error);
            }
        };

        getCamerasFromBackend();
    }, []);

    const handleCameraChange = (value: string) => {
        const newIndex = parseInt(value, 10);
        setSelectedCameraIndex(value);
        localStorage.setItem(CAMERA_INDEX_KEY, value);
        
        invoke('set_selected_camera', { index: newIndex })
            .catch(e => console.error("선택된 카메라를 백엔드에 설정하는 중 오류 발생:", e));
    };

    const openCameraSettings = async () => {
        try {
            const osPlatform = await platform();
            if (osPlatform === 'macos') {
                await Command.create('open-settings', ["x-apple.systempreferences:com.apple.preference.security?Privacy_Camera"]).execute();
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
                    <span className="font-medium">{t('settings.cameraSelect', '분석에 사용할 카메라')}</span>
                    <Select value={selectedCameraIndex} onValueChange={handleCameraChange} disabled={cameras.length === 0}>
                        <SelectTrigger className="w-[250px]">
                            <SelectValue placeholder={cameras.length === 0 ? t('settings.cameraNone', '사용 가능한 카메라 없음') : t('settings.cameraSelectPlaceholder', '카메라를 선택하세요')} />
                        </SelectTrigger>
                        <SelectContent>
                            {cameras.map((camera) => (
                                <SelectItem key={camera.index} value={camera.index.toString()}>
                                    {camera.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </CardContent>
        </Card>
    );
};

const DetectionSettings = () => {
    const { t } = useTranslation();

    const [frequency, setFrequency] = useState<string>(() => localStorage.getItem(NOTIFICATION_FREQUENCY_KEY) || '2');
    const [turtleNeckSensitivity, setTurtleNeckSensitivity] = useState<string>(() => localStorage.getItem(TURTLE_NECK_SENSITIVITY_KEY) || '2');
    const [shoulderSensitivity, setShoulderSensitivity] = useState<string>(() => localStorage.getItem(SHOULDER_SENSITIVITY_KEY) || '2');
    // ✨ 모니터링 주기 상태 추가 (기본값 '3'초)
    const [monitoringInterval, setMonitoringInterval] = useState<string>(() => localStorage.getItem(MONITORING_INTERVAL_KEY) || '3');

    useEffect(() => {
        // LocalStorage에 각 설정값 저장
        localStorage.setItem(NOTIFICATION_FREQUENCY_KEY, frequency);
        localStorage.setItem(TURTLE_NECK_SENSITIVITY_KEY, turtleNeckSensitivity);
        localStorage.setItem(SHOULDER_SENSITIVITY_KEY, shoulderSensitivity);
        // ✨ 모니터링 주기 값 저장
        localStorage.setItem(MONITORING_INTERVAL_KEY, monitoringInterval);

        // 백엔드로 감지 관련 설정 전송
        invoke('set_detection_settings', {
            frequency: parseInt(frequency, 10),
            turtleSensitivity: parseInt(turtleNeckSensitivity, 10),
            shoulderSensitivity: parseInt(shoulderSensitivity, 10),
        }).catch(console.error);

        // ✨ 백엔드로 모니터링 주기 설정 전송
        invoke('set_monitoring_interval', {
            intervalSecs: parseInt(monitoringInterval, 10),
        }).catch(console.error);
        
    // ✨ dependency array에 monitoringInterval 추가
    }, [frequency, turtleNeckSensitivity, shoulderSensitivity, monitoringInterval]);

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('settings.detectionTitle', '감지 및 알림 설정')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* ✨ 모니터링 주기 설정 UI 추가 */}
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <span className="font-medium">{t('settings.monitoringInterval', '모니터링 주기')}</span>
                      <p className="text-sm text-gray-500">{t('settings.monitoringIntervalDesc', '자세를 분석하는 시간 간격을 설정합니다.')}</p>
                    </div>
                    <Select value={monitoringInterval} onValueChange={setMonitoringInterval}>
                        <SelectTrigger className="w-[250px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="3">{t('settings.interval3s', '3초')}</SelectItem>
                            <SelectItem value="5">{t('settings.interval5s', '5초')}</SelectItem>
                            <SelectItem value="7">{t('settings.interval7s', '7초')}</SelectItem>
                            <SelectItem value="10">{t('settings.interval10s', '10초')}</SelectItem>
                            <SelectItem value="15">{t('settings.interval15s', '15초')}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <span className="font-medium">{t('settings.notificationFrequency', '알림 빈도')}</span>
                      <p className="text-sm text-gray-500">{t('settings.notificationFrequencyDesc', '최근 3번의 감지 중 몇 번 이상 나쁜 자세가 감지되면 알림을 받을지 설정합니다.')}</p>
                    </div>
                    <Select value={frequency} onValueChange={setFrequency}>
                        <SelectTrigger className="w-[250px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="1">{t('settings.frequencyOnce', '1번 (민감)')}</SelectItem>
                            <SelectItem value="2">{t('settings.frequencyTwice', '2번 (보통)')}</SelectItem>
                            <SelectItem value="3">{t('settings.frequencyThrice', '3번 (둔감)')}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex items-center justify-between">
                     <div className="space-y-1">
                        <span className="font-medium">{t('settings.turtleNeckSensitivity', '거북목 감지 강도')}</span>
                         <p className="text-sm text-gray-500">{t('settings.turtleNeckSensitivityDesc', '거북목 자세를 얼마나 엄격하게 감지할지 설정합니다.')}</p>
                    </div>
                    <Select value={turtleNeckSensitivity} onValueChange={setTurtleNeckSensitivity}>
                        <SelectTrigger className="w-[250px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="1">{t('settings.sensitivityLoose', '느슨하게')}</SelectItem>
                            <SelectItem value="2">{t('settings.sensitivityNormal', '보통')}</SelectItem>
                            <SelectItem value="3">{t('settings.sensitivityStrict', '엄격하게')}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <span className="font-medium">{t('settings.shoulderSensitivity', '어깨 정렬 감지 강도')}</span>
                        <p className="text-sm text-gray-500">{t('settings.shoulderSensitivityDesc', '어깨 비대칭을 얼마나 엄격하게 감지할지 설정합니다.')}</p>
                    </div>
                    <Select value={shoulderSensitivity} onValueChange={setShoulderSensitivity}>
                        <SelectTrigger className="w-[250px]"><SelectValue /></SelectTrigger>
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
                await Command.create('open-settings', ["x-apple.systempreferences:com.apple.preference.notifications"]).execute();
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
                    <SelectTrigger className="w-[250px]"><SelectValue /></SelectTrigger>
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
            <DetectionSettings />
            <CameraSettings />
            <NotificationSettings />
        </div>
    );
};

export default SettingsPage;