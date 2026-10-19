import { StyleSheet, Text, TouchableOpacity } from 'react-native';

const ContinueButton = ({ label, onPress }) => (
  <TouchableOpacity style={styles.button} onPress={onPress}>
    <Text style={styles.text}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#007bff',
    borderRadius: 10,
    paddingVertical: 15,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    elevation: 5,
  },
  text: { fontSize: 18, color: '#fff', fontWeight: 'bold' },
});

export default ContinueButton;
