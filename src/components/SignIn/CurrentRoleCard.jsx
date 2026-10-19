import { StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome'; // You might need to install this library

const CurrentRoleCard = ({ role }) => {
  const displayRoleName = role
  return (
    <View style={styles.container}>
      <View style={styles.roleInfo}>
        <Icon name="user-circle" size={24} color="#333" style={styles.roleIcon} />
        <Text style={styles.roleName}>{displayRoleName}</Text>
      </View>
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
  roleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  roleIcon: {
    marginRight: 10,
  },
  roleName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  changeRoleButton: {
    backgroundColor: '#e0e0e0',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: '#d0d0d0',
  },
  changeRoleButtonText: {
    fontSize: 14,
    color: '#555',
    fontWeight: '500',
  },
});

export default CurrentRoleCard;
