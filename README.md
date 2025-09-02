# Pose Nudge - AI 기반 자세 교정 도우미

Pose Nudge는 웹캠을 활용하여 실시간으로 자세를 분석하고, 거북목과 같이 자세가 흐트러졌을 때 알림을 보내 바른 자세를 유도하는 Tauri 기반의 데스크톱 애플리케이션입니다.

## 🚀 주요 기능

- **실시간 자세 분석**: 웹캠을 통한 실시간 자세 모니터링
- **거북목 감지**: AI 기반 거북목 및 어깨 정렬 상태 분석
- **스마트 알림**: 자세 문제 감지 시 브라우저 알림 제공
- **자세 점수**: 실시간 자세 점수 및 개선 권장사항 제공
- **통계 대시보드**: 자세 개선 진행상황 및 통계 확인
- **개인화 설정**: 알림 간격, 민감도 등 사용자 맞춤 설정

## 🛠️ 기술 스택

### Frontend
- **React 19** - 사용자 인터페이스
- **TypeScript** - 타입 안전성
- **Tailwind CSS 4** - 스타일링
- **shadcn/ui** - UI 컴포넌트 라이브러리
- **React Webcam** - 웹캠 접근

### Backend
- **Rust** - 고성능 백엔드 로직
- **Tauri 2** - 크로스 플랫폼 데스크톱 프레임워크
- **이미지 처리** - Base64 이미지 디코딩 및 분석

### 개발 도구
- **Vite** - 빠른 개발 서버
- **npm** - 패키지 관리

## 📋 시스템 요구사항

- **운영체제**: Windows 10+, macOS 10.15+, Linux
- **웹캠**: 내장 또는 외장 웹캠 필요
- **메모리**: 최소 4GB RAM 권장
- **Node.js**: 18.x 이상
- **Rust**: 1.70.0 이상

## 🚀 설치 및 실행

### 1. 저장소 클론
```bash
git clone https://github.com/your-username/pose-nudge.git
cd pose-nudge
```

### 2. 의존성 설치
```bash
npm install
```

### 3. 개발 모드 실행
```bash
npm run tauri dev
```

### 4. 프로덕션 빌드
```bash
npm run tauri build
```

## 📱 사용 방법

### 1. 웹캠 연결
- 애플리케이션 실행 후 "실시간 모니터링" 탭으로 이동
- 웹캠 접근 권한 허용
- 웹캠이 정상적으로 연결되면 화면에 비디오 스트림이 표시됩니다

### 2. 모니터링 시작
- "실시간 모니터링 활성화" 스위치를 켜기
- 3초마다 자동으로 자세 분석이 수행됩니다
- 거북목이나 어깨 정렬 문제가 감지되면 알림이 표시됩니다

### 3. 결과 확인
- **자세 점수**: 0-100점으로 현재 자세 상태를 점수화
- **상태 표시**: 거북목, 어깨 정렬 상태를 실시간으로 표시
- **개선 권장사항**: 자세 개선을 위한 구체적인 조언 제공

### 4. 대시보드 활용
- **통계 확인**: 일일/주간/월간 자세 개선 진행상황
- **세션 기록**: 모니터링 세션 시간 및 좋은 자세 유지 시간
- **알림 이력**: 받은 알림 횟수 및 패턴 분석

## ⚙️ 설정 옵션

### 알림 설정
- **알림 간격**: 30초 ~ 5분 (기본값: 30초)
- **휴식 알림**: 30분 ~ 2시간 간격으로 휴식 알림

### 분석 설정
- **거북목 민감도**: 낮음/보통/높음
- **어깨 정렬 민감도**: 낮음/보통/높음
- **분석 주기**: 1초 ~ 10초 (기본값: 3초)

### 카메라 설정
- **해상도**: 640x480 ~ 1920x1080
- **프레임 레이트**: 15fps ~ 60fps

## 🔧 개발자 가이드

### 프로젝트 구조
```
pose-nudge/
├── src/                    # React 프론트엔드
│   ├── components/         # UI 컴포넌트
│   │   ├── ui/            # shadcn/ui 컴포넌트
│   │   ├── Dashboard.tsx   # 대시보드
│   │   ├── WebcamCapture.tsx # 웹캠 컴포넌트
│   │   └── NotificationSystem.tsx # 알림 시스템
│   ├── lib/               # 유틸리티 함수
│   └── App.tsx            # 메인 앱 컴포넌트
├── src-tauri/             # Rust 백엔드
│   ├── src/
│   │   ├── main.rs        # 메인 백엔드 로직
│   │   └── pose_analysis.rs # 자세 분석 엔진
│   ├── Cargo.toml         # Rust 의존성
│   └── tauri.conf.json    # Tauri 설정
└── public/                # 정적 파일
```

### 자세 분석 알고리즘
현재 구현된 자세 분석은 다음과 같은 방식으로 작동합니다:

1. **이미지 처리**: Base64로 인코딩된 웹캠 이미지를 디코딩
2. **키포인트 추출**: 얼굴, 어깨, 목 등의 주요 포인트 감지 (현재는 더미 데이터)
3. **자세 평가**: 
   - 거북목: 목과 어깨 선의 각도 계산
   - 어깨 정렬: 양쪽 어깨 높이 차이 측정
4. **점수 계산**: 전체적인 자세 점수를 0-100점으로 계산

### 향후 개선 계획
- [ ] MediaPipe나 YOLO-Pose와 같은 실제 ML 모델 통합
- [ ] 더 정확한 자세 분석 알고리즘 구현
- [ ] 사용자별 자세 프로필 학습 기능
- [ ] 운동 및 스트레칭 가이드 제공
- [ ] 클라우드 동기화 기능

## 🤝 기여하기

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다. 자세한 내용은 `LICENSE` 파일을 참조하세요.

## 🙏 감사의 말

- [Tauri](https://tauri.app/) - 크로스 플랫폼 앱 프레임워크
- [shadcn/ui](https://ui.shadcn.com/) - 아름다운 UI 컴포넌트
- [React Webcam](https://github.com/mozmorris/react-webcam) - 웹캠 액세스
- [Tailwind CSS](https://tailwindcss.com/) - 유틸리티 우선 CSS 프레임워크

## 📞 지원 및 문의

문제가 발생하거나 질문이 있으시면 [Issues](https://github.com/your-username/pose-nudge/issues)에 등록해 주세요.

---

**건강한 자세로 더 나은 삶을! 🏃‍♂️💪**
