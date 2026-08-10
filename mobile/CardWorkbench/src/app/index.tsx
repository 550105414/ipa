import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

const WORKSPACE_URL = 'https://xiaoke-sales-workspace.rich-mug-8653.chatgpt.site/';

export default function HomeScreen() {
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const handleNavigation = useCallback((request: { url: string }) => {
    const { url } = request;
    if (
      url === 'about:blank' ||
      url.startsWith('https://') ||
      url.startsWith('http://')
    ) {
      return true;
    }

    void Linking.openURL(url).catch(() => undefined);
    return false;
  }, []);

  const reload = useCallback(() => {
    setErrorMessage(null);
    setIsLoading(true);
    setReloadKey((value) => value + 1);
  }, []);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <WebView
          key={reloadKey}
          source={{ uri: WORKSPACE_URL }}
          style={styles.webView}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          allowsInlineMediaPlayback
          javaScriptEnabled
          domStorageEnabled
          setSupportMultipleWindows={false}
          onShouldStartLoadWithRequest={handleNavigation}
          onLoadStart={() => {
            setIsLoading(true);
            setErrorMessage(null);
          }}
          onLoadEnd={() => setIsLoading(false)}
          onError={({ nativeEvent }) => {
            setIsLoading(false);
            setErrorMessage(nativeEvent.description || '页面暂时无法打开');
          }}
          onHttpError={({ nativeEvent }) => {
            setIsLoading(false);
            setErrorMessage(`服务器返回错误：${nativeEvent.statusCode}`);
          }}
        />

        {isLoading && !errorMessage ? (
          <View style={styles.overlay} pointerEvents="none">
            <ActivityIndicator size="large" color="#2563eb" />
            <Text style={styles.loadingText}>正在打开个人工作台…</Text>
          </View>
        ) : null}

        {errorMessage ? (
          <View style={styles.overlay}>
            <Text style={styles.errorTitle}>加载失败</Text>
            <Text style={styles.errorMessage}>{errorMessage}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={reload}
              style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}>
              <Text style={styles.retryButtonText}>重新加载</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  webView: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 32,
    backgroundColor: '#ffffff',
  },
  loadingText: {
    color: '#475569',
    fontSize: 15,
  },
  errorTitle: {
    color: '#0f172a',
    fontSize: 21,
    fontWeight: '700',
  },
  errorMessage: {
    color: '#64748b',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 6,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#2563eb',
  },
  retryButtonPressed: {
    opacity: 0.75,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
});
