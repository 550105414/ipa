import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { SymbolIcon } from '@/components/symbol-icon';
import { colors } from '@/theme/colors';

const WORKSPACE_URL = 'https://xiaoke-sales-workspace.rich-mug-8653.chatgpt.site/';

const RESPONSE_JSON_POLYFILL = `
(function () {
  if (typeof Response === 'undefined' || typeof Response.json === 'function') return;
  Object.defineProperty(Response, 'json', {
    configurable: true,
    writable: true,
    value: function (data, init) {
      var body = JSON.stringify(data);
      if (body === undefined) throw new TypeError('Value is not JSON serializable');
      var responseInit = init == null ? {} : init;
      var headers = new Headers(responseInit.headers);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
      return new Response(body, {
        headers: headers,
        status: responseInit.status,
        statusText: responseInit.statusText
      });
    }
  });
})();
true;
`;

export default function WorkspaceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const webView = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: colors.card }}>
      <View
        style={{
          minHeight: 56,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          paddingHorizontal: 14,
          borderBottomWidth: 1,
          borderBottomColor: colors.separator,
        }}>
        <Pressable
          accessibilityLabel="返回待办"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 10 })}>
          <SymbolIcon name="chevron.left" size={22} color={colors.label} />
        </Pressable>
        <Text selectable style={{ flex: 1, fontSize: 17, fontWeight: '700', color: colors.label }}>
          客户工作台
        </Text>
        <Pressable
          accessibilityLabel="重新加载工作台"
          accessibilityRole="button"
          onPress={() => {
            setFailed(false);
            webView.current?.reload();
          }}
          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 10 })}>
          <SymbolIcon name="arrow.clockwise" size={20} color={colors.blue} />
        </Pressable>
      </View>

      <WebView
        ref={webView}
        source={{ uri: WORKSPACE_URL }}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        javaScriptEnabled
        domStorageEnabled
        allowsBackForwardNavigationGestures
        applicationNameForUserAgent=" NiuMa-iOS/1.1.0"
        injectedJavaScriptBeforeContentLoaded={RESPONSE_JSON_POLYFILL}
        onLoadStart={() => {
          setLoading(true);
          setFailed(false);
        }}
        onLoadEnd={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setFailed(true);
        }}
        onShouldStartLoadWithRequest={(request) => {
          const scheme = request.url.split(':', 1)[0]?.toLowerCase();
          if (scheme === 'tel' || scheme === 'sms' || scheme === 'mailto') {
            void Linking.openURL(request.url);
            return false;
          }
          return (
            scheme === 'http' ||
            scheme === 'https' ||
            scheme === 'about' ||
            scheme === 'blob' ||
            scheme === 'data'
          );
        }}
        style={{ flex: 1, backgroundColor: '#F3F6FB' }}
      />

      {loading ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: insets.top + 56,
            right: 0,
            bottom: 0,
            left: 0,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(243,246,251,0.82)',
          }}>
          <ActivityIndicator color={colors.blue} size="large" />
        </View>
      ) : null}

      {failed ? (
        <View
          style={{
            position: 'absolute',
            top: insets.top + 56,
            right: 0,
            bottom: 0,
            left: 0,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
            padding: 28,
            backgroundColor: colors.background,
          }}>
          <Text selectable style={{ fontSize: 20, fontWeight: '700', color: colors.label }}>
            工作台暂时无法打开
          </Text>
          <Text selectable style={{ textAlign: 'center', color: colors.secondaryLabel }}>
            请检查网络连接，然后重新加载。
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setFailed(false);
              webView.current?.reload();
            }}
            style={{
              minHeight: 46,
              minWidth: 150,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 15,
              borderCurve: 'continuous',
              backgroundColor: colors.blue,
            }}>
            <Text style={{ color: colors.white, fontWeight: '700' }}>重新加载</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
