# Pose Nudge
<p align="center">
  <!-- 프로젝트 로고를 여기에 추가할 수 있습니다. -->
  <img src="public/logo.png" alt="Pose Nudge Logo" width="150">
  <br>
  <strong>AI-Powered Posture Correction Assistant - Real-time Posture Analysis and Improvement Guide</strong>
</p>

<p align="center">
  <!-- 소셜 및 커뮤니티 배지 -->
  <a href="https://github.com/dduldduck/pose-nudge/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/dduldduck/pose-nudge?style=for-the-badge&logo=github&color=gold"></a>
  <a href="https://github.com/dduldduck/pose-nudge/network/members"><img alt="GitHub Forks" src="https://img.shields.io/github/forks/dduldduck/pose-nudge?style=for-the-badge&logo=github&color=blueviolet"></a>
  <a href="https://github.com/dduldduck/pose-nudge/graphs/contributors"><img alt="All Contributors" src="https://img.shields.io/github/all-contributors/dduldduck/pose-nudge?style=for-the-badge&color=orange"></a>
  <br>
  <!-- 상태 및 릴리즈 배지 -->
  <a href="https://github.com/dduldduck/pose-nudge/releases"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/dduldduck/pose-nudge?style=for-the-badge&color=brightgreen"></a>
  <a href="https://github.com/dduldduck/pose-nudge/releases"><img alt="GitHub Downloads" src="https://img.shields.io/github/downloads/dduldduck/pose-nudge/total?style=for-the-badge&logo=github&color=success"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/dduldduck/pose-nudge?style=for-the-badge&color=informational"></a>
  <br>
  <!-- 개발 활동 배지 -->
  <a href="https://github.com/dduldduck/pose-nudge/actions/workflows/release.yml"><img alt="Build Status" src="https://img.shields.io/github/actions/workflow/status/dduldduck/pose-nudge/release.yml?branch=main&style=for-the-badge&logo=githubactions"></a>
  <a href="https://github.com/dduldduck/pose-nudge/issues"><img alt="GitHub Issues" src="https://img.shields.io/github/issues/dduldduck/pose-nudge?style=for-the-badge&logo=github&color=red"></a>
  <a href="https://github.com/dduldduck/pose-nudge/pulls"><img alt="GitHub Pull Requests" src="https://img.shields.io/github/issues-pr/dduldduck/pose-nudge?style=for-the-badge&logo=github&color=yellow"></a>
</p>

<p align="center">
  <a href="./README.md"><img alt="Language-English" src="https://img.shields.io/badge/Language-English-blue?style=for-the-badge"></a>
  <a href="./README.ko.md"><img alt="Language-Korean" src="https://img.shields.io/badge/언어-한국어-blue?style=for-the-badge"></a>
</p>

---

## ✨ Key Features

Pose Nudge is a powerful desktop application that uses your webcam to analyze posture in real-time and sends notifications when posture issues like forward head posture are detected, helping you maintain proper posture.

*   **📹 Real-time Posture Analysis**: Webcam-based real-time posture monitoring and AI-powered analysis
*   **🦴 Forward Head Posture Detection**: Calculates neck and shoulder line angles to detect forward head posture
*   **🔔 Smart Notifications**: Browser notifications and improvement recommendations when posture issues are detected
*   **📊 Posture Score**: Displays current posture status scored from 0-100 points
*   **📈 Statistics Dashboard**: View posture improvement progress and session records
*   **⚙️ Personalized Settings**: Customizable notification intervals, sensitivity, and analysis frequency

---

## 🎥 Demo

### Screenshots

<!-- Add screenshots here -->
<p align="center">
  <img src="screenshots/dashboard.png" alt="Dashboard Screenshot" width="400">
  <img src="screenshots/analysis.png" alt="Posture Analysis Screenshot" width="400">
</p>

### Demo GIF

<!-- Add demo GIF here -->
<p align="center">
  <img src="demo/demo.gif" alt="Demo GIF" width="600">
</p>

---

## 📥 Download

Download the latest version of Pose Nudge for your operating system.

| Operating System | File Format | Download Link |
| :---: | :---: | :---: |
| 💻 **Windows** | `.exe` | <a href="https://github.com/dduldduck/pose-nudge/releases/latest"><img src="https://img.shields.io/badge/Latest_Release-Download-brightgreen?style=flat-square" /></a> |
| 🍏 **macOS** | `.dmg` | <a href="https://github.com/dduldduck/pose-nudge/releases/latest"><img src="https://img.shields.io/badge/Latest_Release-Download-brightgreen?style=flat-square" /></a> |
| 🐧 **Linux** | `.AppImage` | <a href="https://github.com/dduldduck/pose-nudge/releases/latest"><img src="https://img.shields.io/badge/Latest_Release-Download-brightgreen?style=flat-square" /></a> |

---

## 👨‍💻 For Developers

If you're interested in contributing, follow this guide to set up the project locally.

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [Rust](https://www.rust-lang.org/) (v1.70.0 or higher)
- [Git](https://git-scm.com/)

### Installation & Run

```bash
# 1. Clone the project
git clone https://github.com/dduldduck/pose-nudge.git
cd pose-nudge

# 2. Install Node.js dependencies
npm install

# 3. Run in development mode
npm run tauri dev
```

### Project Structure
```
pose-nudge/
├── src/                    # React Frontend
│   ├── components/         # UI Components
│   │   ├── ui/            # shadcn/ui Components
│   │   ├── Dashboard.tsx   # Dashboard
│   │   ├── WebcamCapture.tsx # Webcam Component
│   │   └── SettingsPage.tsx # Settings Page
│   ├── lib/               # Utility Functions
│   ├── locales/           # Internationalization Support
│   └── App.tsx            # Main App Component
├── src-tauri/             # Rust Backend
│   ├── src/
│   │   ├── main.rs        # Main Backend Logic
│   │   ├── pose_analysis.rs # Posture Analysis Engine
│   │   └── notifications.rs # Notification System
│   ├── Cargo.toml         # Rust Dependencies
│   └── tauri.conf.json    # Tauri Configuration
├── models/                # AI Model Files
├── public/                # Static Files
└── locales/               # Localization Files
```

---

## 🛠️ Tech Stack

-   **Framework**: Tauri (Rust + React)
-   **Frontend**: React 19, TypeScript, Tailwind CSS 4
-   **Backend**: Rust, Tauri 2
-   **AI/ML**: YOLO-Pose Model (planned for future integration)
-   **Build/Deployment**: Tauri CLI

---

## 🤝 Contributing

Contributions are always welcome! Whether it's bug reports, feature suggestions, or code contributions, we welcome all forms of participation. Please check out our [Contributing Guidelines](CONTRIBUTING.md) for more details.

---

## ✨ Contributors

Thanks to these wonderful people who have made this project better! ([emoji key](https://allcontributors.org/docs/en/emoji-key))

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/DDULDDUCK"><img src="https://avatars.githubusercontent.com/u/126528992?v=4?s=100" width="100px;" alt="Jaeseok Song"/><br /><sub><b>Jaeseok Song</b></sub></a><br /><a href="https://github.com/dduldduk/pose-nodge/commits?author=DDULDDUCK" title="Code">💻</a> <a href="#maintenance-DDULDDUCK" title="Maintenance">🚧</a></td>
    </tr>
  </tbody>
  <tfoot>
    <tr>
      <td align="center" size="13px" colspan="7">
        <img src="https://raw.githubusercontent.com/all-contributors/all-contributors-cli/1b8533af435da9854653492b1327a23a4dbd0a10/assets/logo-small.svg">
          <a href="https://all-contributors.js.org/docs/en/bot/usage">Add your contributions</a>
        </img>
      </td>
    </tr>
  </tfoot>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

---

## 📜 License

This project is licensed under the [AGPLv3 License](LICENSE).

## Contributors ✨

Thanks goes to these wonderful people ([emoji key](https://allcontributors.org/docs/en/emoji-key)):

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->
<!-- ALL-CONTRIBUTORS-LIST:END -->

This project follows the [all-contributors](https://github.com/all-contributors/all-contributors) specification. Contributions of any kind welcome!
