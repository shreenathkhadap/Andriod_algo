import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const RoleSelector = ({ selectedRole, onSelectRole, rolesData }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <View style={styles.selectorContainer}>
      <Text style={styles.selectorLabel}>Role</Text>

      <TouchableOpacity
        style={styles.dropdownButton}
        onPress={() => setIsOpen(!isOpen)}
        activeOpacity={0.8}
      >
        <Text style={styles.dropdownButtonText}>
          {selectedRole ? selectedRole.name : 'Choose Your Role'}
        </Text>
        <Text style={styles.dropdownIcon}>{isOpen ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {isOpen && (
        <View style={styles.dropdownListContainer}>
          <ScrollView
            style={styles.dropdownList}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {rolesData.map((role) => (
              <TouchableOpacity
                key={role.id}
                style={styles.dropdownItem}
                onPress={() => {
                  onSelectRole(role);
                  setIsOpen(false);
                }}
              >
                <Text style={styles.dropdownItemText}>{role.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  selectorContainer: {
    marginBottom: 20,
    zIndex: 10,
  },
  selectorLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  dropdownButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 15,
    backgroundColor: '#f0f0f0',
  },
  dropdownButtonText: {
    fontSize: 16,
    color: '#333',
    flex: 1,
  },
  dropdownIcon: {
    fontSize: 16,
    color: '#666',
    marginLeft: 8,
  },
  dropdownListContainer: {
    maxHeight: 200, // Limit height for mobile usability
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  dropdownList: {
    paddingVertical: 4,
    zIndex: 1000
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

export default RoleSelector;
