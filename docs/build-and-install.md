# Octo Captures - 빌드 및 설치 가이드

## 사전 요구 사항

- **Node.js** 및 **npm** 설치
- **Xcode Command Line Tools** 설치
- **Apple Developer ID Application 인증서** (Keychain Access에 등록되어 있어야 함)

### 인증서 확인

```bash
security find-identity -v -p codesigning
```

## 빌드

### 1. 의존성 설치

```bash
npm install
```

### 2. 빌드 실행

```bash
# DMG + ZIP 모두 빌드
npm run build

# DMG만 빌드
npm run build:dmg

# ZIP만 빌드
npm run build:zip
```

빌드 결과물은 `release/` 디렉토리에 생성됩니다:

| 파일 | 설명 |
| --- | --- |
| `Octo Captures-{version}-universal.dmg` | macOS DMG 설치 이미지 |
| `Octo Captures-{version}-universal-mac.zip` | macOS ZIP 아카이브 |

### 코드 서명 설정

`package.json`의 `build.mac.identity` 필드에 인증서 이름이 설정되어 있습니다:

```json
{
  "build": {
    "mac": {
      "identity": "hunsang jo (AZ55QRXUCH)"
    }
  }
}
```

> `"Developer ID Application:"` 접두사는 electron-builder가 자동으로 추가하므로 생략해야 합니다.

## 설치

### DMG를 이용한 설치

```bash
# 1. DMG 마운트
hdiutil attach "release/Octo Captures-0.0.1-universal.dmg"

# 2. Applications 폴더로 복사
cp -R "/Volumes/Octo Captures 0.0.1-universal/Octo Captures.app" /Applications/

# 3. DMG 언마운트
hdiutil detach "/Volumes/Octo Captures 0.0.1-universal"
```

또는 DMG 파일을 더블 클릭하여 Finder에서 드래그 앤 드롭으로 설치할 수 있습니다.

### 설치 확인

```bash
# 앱 존재 확인
ls /Applications/Octo\ Captures.app

# 코드 서명 확인
codesign -dv /Applications/Octo\ Captures.app
```

정상적으로 서명된 경우 다음과 같은 정보가 출력됩니다:

```
Identifier=com.johunsang.octo-captures
Format=app bundle with Mach-O universal (x86_64 arm64)
TeamIdentifier=AZ55QRXUCH
```

## 공증 (Notarization)

`package.json`에 `"notarize": true`가 설정되어 있으며, 빌드 시 환경변수를 통해 Apple 공증이 자동으로 진행됩니다.

### 사전 준비

1. [appleid.apple.com](https://appleid.apple.com) &gt; 로그인 및 보안 &gt; 앱 전용 비밀번호에서 비밀번호 생성
2. (선택) Keychain에 자격 증명 저장:

```bash
xcrun notarytool store-credentials "notarytool" \
  --apple-id "johunsang@hotmail.com" \
  --team-id "AZ55QRXUCH"
```

### 공증 포함 빌드

```bash
APPLE_ID="johunsang@hotmail.com" \
APPLE_APP_SPECIFIC_PASSWORD="앱전용비밀번호" \
APPLE_TEAM_ID="AZ55QRXUCH" \
npm run build
```

### 공증 확인

```bash
spctl --assess --type exec -vvv /Applications/Octo\ Captures.app
```

정상적으로 공증된 경우:

```
/Applications/Octo Captures.app: accepted
source=Notarized Developer ID
origin=Developer ID Application: hunsang jo (AZ55QRXUCH)
```