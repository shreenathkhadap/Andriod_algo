import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { loginInAksha } from '../api/apiService';
import AppLogoHeader from '../components/SignIn/AppLogoHeader';
import SignInForm from '../components/SignIn/SignInForm';
import { useAuth } from '../context/AuthContext';
import { router } from 'expo-router';
import { useState } from 'react';

const LoginScreen = () => {
    const { signIn } = useAuth();
    const [loading, setLoading] = useState(false);

    const handleLogin = async (username, password, expoToken) => {
        setLoading(true);
        try {
            const response = await loginInAksha(username, password, expoToken);

            if (!response || !response.token) {
                throw { response: { status: 401 } };
            }

            const user = {
                email:      response.email,
                role:       'admin',
                token:      response.token,
                isVerified: true,
                id:         response.email,
                siteId:     response.siteId,
                mobileId:   response.mobile_id,
                username:   response.username,
            };

            await signIn({ user });

        } catch (err) {
            throw err;
        } finally {
            setLoading(false);
        }
    };

    return (
        <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <ScrollView
                contentContainerStyle={styles.container}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                <AppLogoHeader />
                <SignInForm
                    onSignIn={handleLogin}
                    loading={loading}
                    onSignUp={() => router.push('/signup')}
                />
            </ScrollView>
        </KeyboardAvoidingView>
    );
};

const styles = StyleSheet.create({
    flex: { flex: 1 },
    container: {
        flexGrow: 1,
        backgroundColor: '#f0f2f5',
        alignItems: 'center',
        paddingVertical: 30,
        paddingHorizontal: 15,
    },
});

export default LoginScreen;