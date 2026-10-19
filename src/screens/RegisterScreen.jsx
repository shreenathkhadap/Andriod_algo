import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';  // ← ADD Alert
import AppLogoHeader from '../components/SignIn/AppLogoHeader';
import SignUpForm from '../components/SignUp/SignUpForm';
import { registerUser } from '../api/apiService';
import { router } from 'expo-router';

const SignUpScreen = () => {
  const [loading, setLoading] = useState(false);

  const handleSignUp = async (username, email, password, siteId) => {
  setLoading(true);
  try {
    
    const response = await registerUser(username, email, password, siteId);
      console.log('signup response', response);

      Alert.alert(
        'Account Created!',
        'Your account has been created. Please sign in.',
        [{ text: 'Sign In', onPress: () => router.push('/signin') }]
      );

    } catch (err) {
      console.error('Register error:', err);
      const status  = err?.response?.status;
      const message = err?.response?.data?.message;

      if (status === 409) {
        Alert.alert('Already Registered', 'This email is already registered. Please sign in.');
      } else if (status === 400) {
        Alert.alert('Invalid Input', message || 'Please check your details.');
      } else {
        Alert.alert('Error', message || 'Registration failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

 return (
    <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: '#f0f2f5' }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
        <ScrollView
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
        >
            <AppLogoHeader />
            <SignUpForm
                onSignUp={handleSignUp}
                loading={loading}
                onSignIn={() => router.push('/signin')}
            />
        </ScrollView>
    </KeyboardAvoidingView>
);
};

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#f0f2f5',
    alignItems: 'center',
    paddingVertical: 30,
    paddingHorizontal: 15,
  },
});

export default SignUpScreen;