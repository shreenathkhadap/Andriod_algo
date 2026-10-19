import React, { useEffect, useState } from 'react';
import {
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const LanguageSelector = ({
  label,
  onChange,
  selectedLanguage,
  languagesData,
  placeholderText,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const languages = languagesData || [];
  const currentLanguageObject = languages.find(
    (lang) => lang.value === selectedLanguage
  );

  useEffect(() => {
    if (!selectedLanguage && languages.length > 0) {
      const defaultLang = languages.find((lang) => lang.value === 'en');
      if (defaultLang) {
        onChange(defaultLang.value);
      }
    }
  }, [selectedLanguage, languages, onChange]);

  const handleLanguageSelect = (language) => {
    onChange(language.value);
    setIsOpen(false);
  };

  return (
    <View style={styles.selectorWrapper}>
      <Text style={styles.selectorLabel}>{label}</Text>

      <TouchableOpacity
        style={styles.dropdownButton}
        onPress={() => setIsOpen(!isOpen)}
        activeOpacity={0.8}
      >
        <Text style={styles.dropdownButtonText} numberOfLines={1}>
          {currentLanguageObject
            ? currentLanguageObject.label
            : placeholderText || 'Choose Your Language'}
        </Text>
        <Text style={styles.dropdownIcon}>{isOpen ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {isOpen && (
        <View style={styles.dropdownListContainer}>
          <ScrollView
            style={styles.dropdownList}
            nestedScrollEnabled={true}
            showsVerticalScrollIndicator={true}
            keyboardShouldPersistTaps="handled"
          >
            {languages.map((language) => (
              <TouchableOpacity
                key={language.value}
                style={styles.dropdownItem}
                onPress={() => handleLanguageSelect(language)}
              >
                <Text style={styles.dropdownItemText}>
                  {language.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  selectorWrapper: {
    mariginTop: 40,  
    marginBottom: 20,
    position: 'relative',
    zIndex: 1000,
    width: '100%',
  },
  selectorLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  dropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 15,
    backgroundColor: '#f0f0f0',
    width: '100%',
  },
  dropdownButtonText: {
    fontSize: 16,
    color: '#333',
    flexShrink: 1,
    flexGrow: 1,
    flexWrap: 'wrap',
  },
  dropdownIcon: {
    fontSize: 16,
    color: '#666',
    marginLeft: 8,
  },
  dropdownListContainer: {
    maxHeight: 180,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    backgroundColor: '#fff',
    marginTop: 6,
    width: '100%',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    zIndex: 999,
  },
  dropdownList: {
    width: '100%',
  },
  dropdownItem: {
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  dropdownItemText: {
    fontSize: 16,
    color: '#333',
  },
});

export default LanguageSelector;
