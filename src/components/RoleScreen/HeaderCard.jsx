import { Image, StyleSheet, Text, View } from 'react-native';
import Aksha from '../../../assets/images/AkshaLogo.png';

const HeaderCard = ({ title }) => (
  <View style={styles.card}>
    <Image
      source={Aksha}
      style={styles.logo}
      resizeMode="contain"
    />
    <Text style={styles.company}>Aksha</Text>
    <Text style={styles.subtitle}>{title}</Text>
  </View>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    width: '100%',
    maxWidth: 400,
    elevation: 3,
    marginBottom: 20,
  },
  logo: { width: 80, height: 80, marginBottom: 10 },
  company: { fontSize: 22, fontWeight: 'bold', color: '#333', marginBottom: 5 },
  subtitle: { fontSize: 16, color: '#666' },
});

export default HeaderCard;
