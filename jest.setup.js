// AsyncStorage is a native module with no JS implementation under Jest; the
// package ships this mock for exactly that reason.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
