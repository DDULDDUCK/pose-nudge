import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// 나중에 생성할 언어 파일들을 import 합니다.
import translationEN from './locales/en/translation.json';
import translationKO from './locales/ko/translation.json';
import translationJA from './locales/ja/translation.json';
import translationZH from './locales/zh/translation.json';

const resources = {
  en: {
    translation: translationEN,
  },
  ko: {
    translation: translationKO,
  },
  ja: {
    translation: translationJA,
  },
  zh: {
    translation: translationZH,
  },
};

i18n
  .use(LanguageDetector) // 사용자의 언어 감지
  .use(initReactI18next) // react-i18next 초기화
  .init({
    resources,
    fallbackLng: 'en', // 기본 언어가 없을 경우 영어로 대체
    debug: true, // 개발 중에는 true로 설정하여 디버깅 정보 확인
    interpolation: {
      escapeValue: false, // React는 이미 XSS 방지를 하므로 false로 설정
    },
  });

export default i18n;