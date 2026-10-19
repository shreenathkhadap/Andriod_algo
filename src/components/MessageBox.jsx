import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';

const MessageBox = ({ message, visible, onClose }) => {
  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.messageBoxOverlay}>
        <View style={styles.messageBoxContainer}>
          <Text style={styles.messageBoxText}>{message}</Text>
          <TouchableOpacity style={styles.messageBoxButton} onPress={onClose}>
            <Text style={styles.messageBoxButtonText}>OK</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  messageBoxOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  messageBoxContainer: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 20,
    alignItems: 'center',
    width: '80%',
    maxWidth: 300,
  },
  messageBoxText: {
    fontSize: 16,
    marginBottom: 20,
    textAlign: 'center',
  },
  messageBoxButton: {
    backgroundColor: '#007bff',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  messageBoxButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default MessageBox;
