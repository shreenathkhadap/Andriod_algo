import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const RoleDetails = ({ role }) => {
  if (!role || typeof role !== 'object') return null;

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>👤</Text>
      <Text style={styles.name}>{role.name}</Text>
      <Text style={styles.desc}>{role.description}</Text>
      <TouchableOpacity style={styles.button}>
        <Text style={styles.buttonText}>{role.access}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 20,
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 10,
    backgroundColor: '#fdfdfd',
  },
  icon: { fontSize: 50, marginBottom: 10, color: '#007bff' },
  name: { fontSize: 20, fontWeight: 'bold', color: '#007bff', marginBottom: 5 },
  desc: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 15,
    paddingHorizontal: 15,
  },
  button: {
    backgroundColor: '#e0f7fa',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 15,
  },
  buttonText: { fontSize: 14, color: '#007bff', fontWeight: '600' },
});

export default RoleDetails;
