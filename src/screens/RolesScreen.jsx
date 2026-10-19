import axios from 'axios';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { languages } from '../../data/languages';
import ContinueButton from '../components/RoleScreen/ContinueButton';
import Footer from '../components/RoleScreen/Footer';
import HeaderCard from '../components/RoleScreen/HeaderCard';
import LanguageSelector from '../components/RoleScreen/LanguageSelector';

const defaultStrings = {
  language: 'Language',
  chooseRole: 'Choose Your Role',
  continueSignIn: 'Continue',
  pleaseSelectRole: 'Please select a role.',
  continueSignInAs: 'Continue to sign in as',
  title: 'AI Surveilance',
};


const languageOptions = Object.keys(languages).map(key => ({
  label: languages[key].language,
  value: key,
}));

const RolesScreen = () => {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState(null); 
  const [messageBoxVisible, setMessageBoxVisible] = useState(false);
  const [messageBoxText, setMessageBoxText] = useState('');
  const [currentLanguage, setCurrentLanguage] = useState('en');
  const [translations, setTranslations] = useState(defaultStrings);

  const showMessageBox = (message) => {
    setMessageBoxText(message);
    setMessageBoxVisible(true);
  };

  const hideMessageBox = () => {
    setMessageBoxVisible(false);
    setMessageBoxText('');
  };

  const handleContinue = () => {

     router.push({
      pathname: '/signin',
      params: {
        language: currentLanguage,
      },
    });
    
  };

  const handleLanguageChange = async (langCode) => {
    setCurrentLanguage(langCode);
    if (langCode === 'en') return setTranslations(languages[langCode]);

    try {
      const newTranslations = {};
      for (const key of Object.keys(defaultStrings)) {
        const res = await axios.get('https://api.mymemory.translated.net/get', {
          params: {
            q: defaultStrings[key],
            langpair: `en|${langCode}`,
          },
        });
        newTranslations[key] = res.data.responseData.translatedText;
      }
      setTranslations(newTranslations);
    } catch (error) {
      showMessageBox("Translation failed. Please check your internet.");
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <LanguageSelector
        selectedLanguage={currentLanguage}
        onChange={handleLanguageChange}
        label={translations.language}
        languagesData={languageOptions} 
        placeholderText="Choose Your Language"
      />
      <HeaderCard title={translations.title} />
      <ContinueButton label={translations.continueSignIn} onPress={handleContinue} />
      <Footer/>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#f0f2f5',
    alignItems: 'center',
    paddingVertical: 30,
    paddingTop: 40,
    marginTop: 40,
    paddingHorizontal: 15,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    elevation: 3,
    marginBottom: 20,
  },
});

export default RolesScreen;
