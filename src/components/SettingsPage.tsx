import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Command, open } from '@tauri-apps/plugin-shell';
import { platform } from '@tauri-apps/plugin-os';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import { useTheme } from 'next-themes';

// --- LocalStorage Keys ---
const LANGUAGE_KEY = "pose_nudge_language";
const NOTIFICATION_FREQUENCY_KEY = "pose_nudge_notification_frequency";
const TURTLE_NECK_SENSITIVITY_KEY = "pose_nudge_turtle_neck_sensitivity";
const SHOULDER_SENSITIVITY_KEY = "pose_nudge_shoulder_sensitivity";
const CAMERA_INDEX_KEY = "pose_nudge_camera_index";
const MONITORING_INTERVAL_KEY = "pose_nudge_monitoring_interval";
const BATTERY_SAVING_MODE_KEY = "pose_nudge_battery_saving_mode";

// --- Type Definitions ---
interface CameraDetail {
    index: number;
    name: string;
}

// --- Components ---

const LanguageSettings = () => {
    const { i18n, t } = useTranslation();
    const [lang, setLang] = useState(() => localStorage.getItem(LANGUAGE_KEY) || i18n.language || 'ko');

    // 앱 시작 시(컴포넌트 마운트 시) 백엔드에 현재 언어 동기화
    useEffect(() => {
    // 1. 우선순위에 따라 초기 언어를 결정합니다.
    const initialLang = 
        localStorage.getItem(LANGUAGE_KEY) || // 1순위: 사용자가 직접 저장한 설정
        i18n.language ||                     // 2순위: LanguageDetector가 감지한 시스템 언어
        'en';                                // 3순위: 모든 것이 실패했을 때의 최종 기본값

    // 2. 결정된 언어로 앱의 상태를 일관되게 업데이트합니다.
    if (initialLang !== i18n.language) {
        i18n.changeLanguage(initialLang);
    }
    setLang(initialLang);
    localStorage.setItem(LANGUAGE_KEY, initialLang);
    invoke('set_current_language', { lang: initialLang }).catch(console.error);
    
    }, []);

    // 언어 변경 핸들러
    const handleChange = (value: string) => {
        i18n.changeLanguage(value);
        setLang(value);
        localStorage.setItem(LANGUAGE_KEY, value);
        // 언어가 변경될 때마다 백엔드에 알림
        invoke('set_current_language', { lang: value }).catch(console.error);
    };

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
                        <SelectItem value="ja">{t('settings.languageJapanese', '日本語')}</SelectItem>
                        <SelectItem value="zh">{t('settings.languageChinese', '简体中文')}</SelectItem>
                    </SelectContent>
                </Select>
            </CardContent>
        </Card>
    );
};


const DetectionSettings = () => {
    const { t } = useTranslation();

    const [batterySavingMode, setBatterySavingMode] = useState(() => localStorage.getItem(BATTERY_SAVING_MODE_KEY) === 'true');
    const [frequency, setFrequency] = useState<string>(() => localStorage.getItem(NOTIFICATION_FREQUENCY_KEY) || '2');
    const [turtleNeckSensitivity, setTurtleNeckSensitivity] = useState<string>(() => localStorage.getItem(TURTLE_NECK_SENSITIVITY_KEY) || '2');
    const [shoulderSensitivity, setShoulderSensitivity] = useState<string>(() => localStorage.getItem(SHOULDER_SENSITIVITY_KEY) || '2');
    const [monitoringInterval, setMonitoringInterval] = useState<string>(() => localStorage.getItem(MONITORING_INTERVAL_KEY) || '3');

    useEffect(() => {
        // 앱 시작 시 백엔드에 절약 모드 상태 동기화
        invoke('set_battery_saving_mode', { mode: batterySavingMode }).catch(console.error);
    }, []);

    useEffect(() => {
        localStorage.setItem(NOTIFICATION_FREQUENCY_KEY, frequency);
        localStorage.setItem(TURTLE_NECK_SENSITIVITY_KEY, turtleNeckSensitivity);
        localStorage.setItem(SHOULDER_SENSITIVITY_KEY, shoulderSensitivity);
        localStorage.setItem(MONITORING_INTERVAL_KEY, monitoringInterval);

        invoke('set_detection_settings', {
            frequency: batterySavingMode ? 1 : parseInt(frequency, 10),
            turtleSensitivity: parseInt(turtleNeckSensitivity, 10),
            shoulderSensitivity: parseInt(shoulderSensitivity, 10),
        }).catch(console.error);

        if (batterySavingMode) {
            invoke('set_monitoring_interval', {
                intervalMins: parseInt(monitoringInterval, 10),
            }).catch(console.error);
        } else {
            invoke('set_monitoring_interval', {
                intervalSecs: parseInt(monitoringInterval, 10),
            }).catch(console.error);
        }

    }, [frequency, turtleNeckSensitivity, shoulderSensitivity, monitoringInterval, batterySavingMode]);

    const monitoringOptions = batterySavingMode ? [
        { value: '3', label: t('settings.interval3m', '3분') },
        { value: '5', label: t('settings.interval5m', '5분') },
        { value: '10', label: t('settings.interval10m', '10분') },
        { value: '15', label: t('settings.interval15m', '15분') },
        { value: '30', label: t('settings.interval30m', '30분') },
    ] : [
        { value: '3', label: t('settings.interval3s', '3초') },
        { value: '5', label: t('settings.interval5s', '5초') },
        { value: '7', label: t('settings.interval7s', '7초') },
        { value: '10', label: t('settings.interval10s', '10초') },
        { value: '15', label: t('settings.interval15s', '15초') },
    ];

    const handleBatterySavingToggle = (checked: boolean) => {
        setBatterySavingMode(checked);
        localStorage.setItem(BATTERY_SAVING_MODE_KEY, checked.toString());
        if (checked) {
            setFrequency('1');
        }
        invoke('set_battery_saving_mode', { mode: checked }).catch(console.error);
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('settings.detectionTitle', '감지 및 알림 설정')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                       <span className="font-medium">{t('settings.batterySavingMode', '배터리 절약 모드')}</span>
                       <p className="text-sm text-muted-foreground">{t('settings.batterySavingModeDesc', '활성화 시 모니터링 주기를 분단위로 변경하고 카메라를 절약 모드로 운영합니다.')}</p>
                    </div>
                    <Switch checked={batterySavingMode} onCheckedChange={handleBatterySavingToggle} />
                </div>
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                       <span className="font-medium">{t('settings.monitoringInterval', '모니터링 주기')}</span>
                       <p className="text-sm text-muted-foreground">{t('settings.monitoringIntervalDesc', '자세를 분석하는 시간 간격을 설정합니다.')}</p>
                    </div>
                    <Select value={monitoringInterval} onValueChange={setMonitoringInterval}>
                        <SelectTrigger className="w-[250px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {monitoringOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                       <span className="font-medium">{t('settings.notificationFrequency', '알림 빈도')}</span>
                       <p className="text-sm text-muted-foreground">{batterySavingMode ? t('settings.notificationFrequencyDescBatterySaving', '배터리 절약 모드에서는 1번으로 고정됩니다.') : t('settings.notificationFrequencyDescNormal', '최근 3번의 감지 중 몇 번 이상 나쁜 자세가 감지되면 알림을 받을지 설정합니다.')}</p>
                    </div>
                    <Select value={frequency} onValueChange={setFrequency} disabled={batterySavingMode}>
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
                         <p className="text-sm text-muted-foreground">{t('settings.turtleNeckSensitivityDesc', '거북목 자세를 얼마나 엄격하게 감지할지 설정합니다.')}</p>
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
                        <p className="text-sm text-muted-foreground">{t('settings.shoulderSensitivityDesc', '어깨 비대칭을 얼마나 엄격하게 감지할지 설정합니다.')}</p>
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
                console.error(t('settings.cameraErrorGetList', '백엔드로부터 카메라 목록을 가져오는 중 오류 발생:'), error);
            }
        };

        getCamerasFromBackend();
    }, []);

    const handleCameraChange = (value: string) => {
        const newIndex = parseInt(value, 10);
        setSelectedCameraIndex(value);
        localStorage.setItem(CAMERA_INDEX_KEY, value);
        
        invoke('set_selected_camera', { index: newIndex })
            .catch(e => console.error(t('settings.cameraErrorSetSelected', '선택된 카메라를 백엔드에 설정하는 중 오류 발생:'), e));
    };

    const openCameraSettings = async () => {
        try {
            const osPlatform = await platform();
            if (osPlatform === 'macos') {
                await Command.create('open-settings', ["x-apple.systempreferences:com.apple.preference.security?Privacy_Camera"]).execute();
            } else if (osPlatform === 'windows') {
                await open('ms-settings:privacy-webcam');
            } else {
                alert(t('settings.cameraPermissionDirect', '시스템 설정 > 개인 정보 보호 및 보안 > 카메라에서 앱 권한을 직접 허용해주세요.'));
            }
        } catch (error) {
              console.error(t('settings.settingsErrorOpen', '설정 창을 여는 중 오류 발생:'), error);
              alert(t('settings.cameraPermissionManual', '설정 창을 열 수 없습니다. 수동으로 시스템 설정 > 개인 정보 보호 및 보안 > 카메라로 이동하여 권한을 확인해주세요.'));
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('settings.cameraTitle', '카메라 설정')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="p-4 bg-blue-50 border-l-4 border-blue-400 text-blue-800 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-200">
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


const UpdateSettings = () => {
    const { t } = useTranslation();
    const [isChecking, setIsChecking] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [isInstalling, setIsInstalling] = useState(false);
    const [progress, setProgress] = useState(0);
    const [updateInfo, setUpdateInfo] = useState<{ version: string; date: string } | null>(null);
    const [installed, setInstalled] = useState(false);

    const checkForUpdates = async () => {
        try {
            setIsChecking(true);
            setProgress(0);
            setUpdateInfo(null);
            setInstalled(false);

            const update = await check();

            if (update) {
                setUpdateInfo({ version: update.version || '', date: update.date || '' });
                setIsChecking(false);
                setIsDownloading(true);

                // 업데이트 다운로드 및 설치
                let downloaded = 0;
                let contentLength = 0;

                await update.downloadAndInstall((event) => {
                    switch (event.event) {
                        case 'Started':
                            contentLength = event.data.contentLength || 0;
                            console.log(`started downloading ${event.data.contentLength} bytes`);
                            break;
                        case 'Progress':
                            downloaded += event.data.chunkLength;
                            const currentProgress = contentLength > 0 ? (downloaded / contentLength) * 100 : 0;
                            setProgress(Math.round(currentProgress));
                            console.log(`downloaded ${downloaded} from ${contentLength}`);
                            break;
                        case 'Finished':
                            console.log('download finished');
                            setIsDownloading(false);
                            setIsInstalling(true);
                            break;
                    }
                });

                setIsInstalling(false);
                setInstalled(true);
            } else {
                setIsChecking(false);
            }
        } catch (error) {
            console.error(t('settings.updateErrorCheck', '업데이트 확인 실패:'), error);
            setIsChecking(false);
            setIsDownloading(false);
            setIsInstalling(false);
        }
    };

    const handleRestart = async () => {
        try {
            await invoke('restart_app');
        } catch (error) {
            console.error(t('settings.appErrorRestart', '앱 재시작 실패:'), error);
            alert(t('settings.appRestartManual', '앱을 수동으로 재시작해주세요.'));
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('settings.updateTitle', '업데이트 설정')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="p-4 bg-green-50 border-l-4 border-green-400 text-green-800 dark:bg-green-900 dark:border-green-600 dark:text-green-200">
                    <p>{t('settings.updateGuide', '새로운 버전이 있는지 확인하고 자동으로 업데이트를 설치합니다.')}</p>
                    <Button
                        onClick={checkForUpdates}
                        disabled={isChecking || isDownloading || isInstalling}
                        className="mt-2"
                    >
                        {isChecking ? t('settings.checkingUpdate', '업데이트 확인 중...') : t('settings.checkUpdate', '업데이트 확인')}
                    </Button>

                    {updateInfo && (
                        <p className="mt-2 text-sm">
                            {t('settings.updateFound', '업데이트 발견: {{version}} ({{date}})', { version: updateInfo.version, date: updateInfo.date })}
                        </p>
                    )}

                    {isDownloading && (
                        <div className="mt-4">
                            <p className="text-sm mb-2">{t('settings.updateDownloading', '다운로드 중... {{progress}}%', { progress })}</p>
                            <Progress value={progress} className="w-full" />
                        </div>
                    )}

                    {isInstalling && (
                        <p className="mt-2 text-sm">{t('settings.updateInstalling', '설치 중...')}</p>
                    )}

                    {installed && (
                        <div className="mt-4">
                            <p className="text-sm text-green-700 dark:text-green-300 mb-2">
                                {t('settings.updateInstalled', '업데이트 설치 완료. 앱을 재시작해주세요.')}
                            </p>
                            <Button onClick={handleRestart} variant="outline">
                                {t('settings.restartApp', '앱 재시작')}
                            </Button>
                        </div>
                    )}

                    {!isChecking && !isDownloading && !isInstalling && !installed && !updateInfo && (
                        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                            {t('settings.upToDate', '최신 버전입니다.')}
                        </p>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};

const ThemeSettings = () => {
    const { t } = useTranslation();
    const { theme, setTheme } = useTheme();

    const handleThemeChange = (value: string) => {
        setTheme(value);
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('settings.themeTitle', '테마 설정')}</CardTitle>
            </CardHeader>
            <CardContent>
                <Select value={theme} onValueChange={handleThemeChange}>
                    <SelectTrigger className="w-[250px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="light">{t('settings.themeLight', '밝은 테마')}</SelectItem>
                        <SelectItem value="dark">{t('settings.themeDark', '어두운 테마')}</SelectItem>
                        <SelectItem value="system">{t('settings.themeSystem', '시스템 설정')}</SelectItem>
                    </SelectContent>
                </Select>
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
                alert(t('settings.notificationPermissionDirect', '시스템 설정 > 알림에서 앱의 알림 권한을 직접 허용해주세요.'));
            }
        } catch (error) {
            console.error(t('settings.notificationErrorOpen', '알림 설정 창을 여는 중 오류 발생:'), error);
            alert(t('settings.notificationPermissionManual', '설정 창을 열 수 없습니다. 수동으로 시스템 설정 > 알림으로 이동하여 권한을 확인해주세요.'));
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('settings.notificationTitle', '시스템 알림 설정')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="p-4 bg-blue-50 border-l-4 border-blue-400 text-blue-800 dark:bg-blue-900 dark:border-blue-600 dark:text-blue-200">
                    <p>{t('settings.notificationGuide', '알림이 오지 않는 경우, 아래 버튼을 클릭하여 시스템 설정에서 앱의 알림 권한을 허용해주세요.')}</p>
                    <Button onClick={openNotificationSettings} className="mt-2">
                        {t('settings.notificationGoTo', '알림 설정으로 이동')}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
};

const SettingsPage = () => {
    return (
        <div className="space-y-6 p-4 md:p-6">
            <LanguageSettings />
            <ThemeSettings />
            <DetectionSettings />
            <CameraSettings />
            <NotificationSettings />
            <UpdateSettings />
        </div>
    );
};

export default SettingsPage;