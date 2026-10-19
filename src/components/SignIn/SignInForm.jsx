import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import useNotificationPermission from '../../hooks/useNotificationPermission';

const SignInForm = ({ onSignIn, loading, onSignUp }) => {
  const [identifier, setIdentifier]     = useState('');
  const [password, setPassword]         = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError]               = useState('');
  const [fieldError, setFieldError]     = useState({ identifier: false, password: false });

  const { status: permissionStatus, requestOrOpenSettings } = useNotificationPermission();

  const clearErrors = () => {
    setError('');
    setFieldError({ identifier: false, password: false });
  };

  const validate = () => {
    if (!identifier.trim() && !password.trim()) {
      setFieldError({ identifier: true, password: true });
      setError('Please enter your username and password.');
      return false;
    }
    if (!identifier.trim()) {
      setFieldError({ identifier: true, password: false });
      setError('Please enter your username or email.');
      return false;
    }
    if (!password.trim()) {
      setFieldError({ identifier: false, password: true });
      setError('Please enter your password.');
      return false;
    }
    return true;
  };

  // Gets the push token (if any) and signs in. Sign-in itself never
  // depends on notification permission — a device that never grants it
  // still gets full app access, just without push alerts.
  const completeSignIn = async (id, pwd) => {
    try {
      let expoToken = Platform.OS === 'web' ? 'ExponentPushToken[web-client]' : null;
      if (Platform.OS !== 'web') {
        try {
          const tokenResult = await Notifications.getExpoPushTokenAsync({
            projectId: Constants.expoConfig?.extra?.eas?.projectId,
          });
          expoToken = tokenResult.data;
        } catch (tokenError) {
          console.warn('[sign-in] Push token unavailable; continuing without it:', tokenError?.message);
        }
      }

      await onSignIn(id, pwd, expoToken);

    } catch (err) {
      const status = err?.response?.status;

      if (status === 401) {
        setFieldError({ identifier: true, password: true });
        setError('Incorrect username or password. Please try again.');
      } else if (status === 404) {
        setFieldError({ identifier: true, password: false });
        setError('No account found with this username or email.');
      } else if (status === 400) {
        setFieldError({ identifier: true, password: true });
        setError('Please check your username and password.');
      } else if (status === 429) {
        setError('Too many attempts. Please wait a moment and try again.');
      } else if (!err?.response) {
        setError('Cannot connect to server. Please check your internet connection.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    }
  };

  const handleSignInPress = async () => {
    clearErrors();
    if (!validate()) return;

    // Best-effort only: show the native permission popup if it's never
    // been asked before. Never opens Settings and never blocks sign-in on
    // the result — denied/blocked permission just means no push alerts,
    // not "can't log in". (The one-time "Enable Notifications" prompt in
    // app/_layout.jsx, shown after login, is where a denied/blocked state
    // gets a chance to route to Settings instead — not here.)
    if (permissionStatus === 'undetermined') {
      await requestOrOpenSettings();
    }

    await completeSignIn(identifier.trim(), password);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.subheader}>Aksha Login</Text>

      {/* ── Error box ── */}
      {error ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle-outline" size={16} color="#b91c1c" style={styles.errorIcon} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* ── Username or Email ── */}
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Username or Email</Text>
        <TextInput
          style={[styles.input, fieldError.identifier && styles.inputError]}
          placeholder="Enter username or email"
          placeholderTextColor="#aaa"
          value={identifier}
          onChangeText={(t) => { setIdentifier(t); clearErrors(); }}
          autoCapitalize="none"
          keyboardType="email-address"
          editable={!loading}
        />
      </View>

      {/* ── Password ── */}
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Password</Text>
        <View style={[styles.passwordContainer, fieldError.password && styles.inputError]}>
          <TextInput
            style={styles.passwordInput}
            placeholder="Enter password"
            placeholderTextColor="#aaa"
            value={password}
            onChangeText={(t) => { setPassword(t); clearErrors(); }}
            secureTextEntry={!showPassword}
            editable={!loading}
          />
          <TouchableOpacity
            style={styles.eyeButton}
            onPress={() => setShowPassword((prev) => !prev)}
            disabled={loading}
          >
            <Ionicons
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={22}
              color="#888"
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Sign In button ── */}
      <TouchableOpacity
        style={[styles.signInButton, loading && styles.signInButtonDisabled]}
        onPress={handleSignInPress}
        activeOpacity={0.8}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.signInButtonText}>Sign In</Text>
        )}
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    marginBottom: 20,
  },
  subheader: {
    fontSize: 20,
    color: '#444',
    marginBottom: 20,
    textAlign: 'center',
    fontWeight: '600',
  },

  // ── Error box ──
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  errorIcon: { marginTop: 1, flexShrink: 0 },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: '#b91c1c',
    lineHeight: 18,
  },

  // ── Inputs ──
  inputGroup:  { marginBottom: 16 },
  inputLabel:  { fontSize: 14, color: '#333', marginBottom: 6, fontWeight: '500' },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingVertical: 11,
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#333',
    backgroundColor: '#f9f9f9',
  },
  inputError: {
    borderColor: '#f87171',
    backgroundColor: '#fff5f5',
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    backgroundColor: '#f9f9f9',
  },
  passwordInput: {
    flex: 1,
    paddingVertical: 11,
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#333',
  },
  eyeButton: { paddingHorizontal: 12, paddingVertical: 10 },

  // ── Button ──
  signInButton: {
    backgroundColor: '#035faa',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 22,
  },
  signInButtonText:     { fontSize: 16, color: '#fff', fontWeight: '600' },
  signInButtonDisabled: { backgroundColor: '#90b8d8' },
});

export default SignInForm;