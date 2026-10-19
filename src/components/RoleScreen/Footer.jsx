import { Image, StyleSheet, Text, View } from 'react-native';
import algoanalytics from '../../../assets/images/algoanalytics.png';
const Footer = () => {
  return (
    <View style={styles.footer}>
      <Image
        source={algoanalytics} // Adjust path if needed
        style={styles.footerLogo}
        resizeMode="contain"
      />
      <Text style={styles.footerText}>Developed by AlgoAnalytics</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  footer: {
    marginTop: 40,
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: '#ddd',
    flexDirection: 'row',
    gap: 8,
  },
  footerText: {
    fontSize: 14,
    color: '#888',
  },
  footerLogo: {
    width: 20,
    height: 20,
    marginRight: 6,
  },
});

export default Footer;
