import { Image, StyleSheet, Text, View } from 'react-native';
import Aksha from '../../../assets/images/AkshaLogo.png';
const AppLogoHeader = () => {
  return (
    <View style={styles.container}>
      <Image
        source={Aksha} 
        style={styles.logo}
        accessibilityLabel="Aksha"
        resizeMode="contain"
      />
      <Text style={styles.companyName}>Aksha</Text>
      <Text style={styles.systemName}>AI Surrveilance</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    elevation: 3, // Shadow for Android
    shadowColor: '#000', // Shadow for iOS
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    marginBottom: 20,
  },
  logo: {
    width: 80,
    height: 80,
    marginBottom: 10,
    borderRadius: 10, // Rounded corners for the logo
  },
  companyName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  systemName: {
    fontSize: 16,
    color: '#666',
  },
});

export default AppLogoHeader;
