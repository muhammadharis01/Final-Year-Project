import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { Audio } from 'expo-av';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Platform, StatusBar, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { TajweedError } from '../../services/api';
import { getErrorTypeDisplay } from './errorTypes';

interface Recording {
  id: string;
  surah: number;
  ayah: number;
  uri: string;
  date: string;
  surahName: string;
  accuracy?: number;
  errorCount?: number;
  errors?: TajweedError[];
  mode?: 'verse' | 'surah';
  surahResults?: { ayah: number; accuracy: number; errors: TajweedError[] }[];
}

export default function Saved() {
  const { isDarkMode, toggleTheme, colors } = useTheme();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Load recordings when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadRecordings();

      return () => {
        if (sound) {
          sound.unloadAsync().catch(() => { });
        }
      };
    }, [])
  );

  const loadRecordings = async () => {
    try {
      const data = await AsyncStorage.getItem('recordings');
      if (data) {
        const parsed = JSON.parse(data);
        setRecordings(parsed);
      }
    } catch (err) {
      console.error('Failed to load recordings', err);
    }
  };

  const playRecording = async (recording: Recording) => {
    try {
      if (playingId === recording.id && sound) {
        await sound.stopAsync();
        await sound.unloadAsync();
        setSound(null);
        setPlayingId(null);
        return;
      }

      if (sound) {
        await sound.stopAsync();
        await sound.unloadAsync();
      }

      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: recording.uri },
        { shouldPlay: true }
      );

      setSound(newSound);
      setPlayingId(recording.id);

      newSound.setOnPlaybackStatusUpdate((status: any) => {
        if (status.isLoaded && status.didJustFinish) {
          setPlayingId(null);
          newSound.unloadAsync();
          setSound(null);
        }
      });
    } catch (err) {
      console.error('Failed to play recording', err);
      Alert.alert('Error', 'Failed to play recording');
    }
  };

  const deleteRecording = async (id: string) => {
    Alert.alert(
      'Delete Recording',
      'Are you sure you want to delete this recording?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const updatedRecordings = recordings.filter(r => r.id !== id);
              setRecordings(updatedRecordings);
              await AsyncStorage.setItem('recordings', JSON.stringify(updatedRecordings));

              if (playingId === id && sound) {
                await sound.stopAsync();
                await sound.unloadAsync();
                setSound(null);
                setPlayingId(null);
              }
            } catch (err) {
              console.error('Failed to delete recording', err);
              Alert.alert('Error', 'Failed to delete recording');
            }
          },
        },
      ]
    );
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />

      {/* Header with Dark Mode Toggle */}
      <View style={{ backgroundColor: colors.bg, paddingTop: 50, paddingBottom: 16, paddingHorizontal: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ width: 40 }} />
          <Text style={{ color: colors.text, fontSize: 24, fontWeight: '700', letterSpacing: 0.5 }}>
            Saved Recordings
          </Text>
          <TouchableOpacity onPress={toggleTheme} style={{ padding: 8 }}>
            <Ionicons
              name={isDarkMode ? "sunny" : "moon"}
              size={22}
              color={colors.primary}
            />
          </TouchableOpacity>
        </View>
        <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginTop: 4 }}>
          {recordings.length} recording{recordings.length !== 1 ? 's' : ''}
        </Text>
      </View>

      {recordings.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <View style={{ backgroundColor: colors.surfaceVariant, borderRadius: 999, padding: 24, marginBottom: 16 }}>
            <Ionicons name="bookmark-outline" size={48} color={colors.primary} />
          </View>
          <Text style={{ color: colors.text }} className="text-lg font-semibold text-center">
            No recordings yet
          </Text>
          <Text style={{ color: colors.textSecondary }} className="text-sm text-center mt-2">
            Start practicing to save your recitations
          </Text>
        </View>
      ) : (
        <FlatList
          data={recordings}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            padding: 16,
            paddingBottom: Platform.OS === 'ios' ? 90 : 80
          }}
          bounces={true}
          alwaysBounceVertical={true}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const isExpanded = expandedId === item.id;
            const accuracy = item.mode === 'surah' && item.surahResults
              ? Math.round(item.surahResults.reduce((sum, r) => sum + r.accuracy, 0) / item.surahResults.length)
              : item.accuracy;
            const acColor = accuracy !== undefined
              ? (accuracy >= 90 ? '#22C55E' : accuracy >= 70 ? '#F59E0B' : '#EF4444')
              : colors.textSecondary;

            return (
              <View style={{
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: 16,
                padding: 16,
                marginBottom: 12,
                borderWidth: 1
              }}>
                <TouchableOpacity
                  onPress={() => setExpandedId(isExpanded ? null : item.id)}
                  activeOpacity={0.7}
                >
                  <View className="flex-row justify-between items-start mb-3">
                    <View className="flex-1">
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ color: colors.text }} className="text-base font-semibold">
                          {item.surahName}
                        </Text>
                        {item.mode === 'surah' && (
                          <View style={{ backgroundColor: colors.surfaceVariant, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 }}>
                            <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '600' }}>SURAH</Text>
                          </View>
                        )}
                      </View>
                      <Text style={{ color: colors.textSecondary }} className="text-sm mt-0.5">
                        {item.mode === 'surah' && item.surahResults
                          ? `${item.surahResults.length} verses`
                          : `Ayah ${item.ayah}`}
                        {' '}&bull; {formatDate(item.date)}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {accuracy !== undefined && (
                        <View style={{
                          backgroundColor: acColor,
                          paddingHorizontal: 10,
                          paddingVertical: 4,
                          borderRadius: 12
                        }}>
                          <Text style={{ color: 'white', fontSize: 13, fontWeight: '700' }}>
                            {accuracy}%
                          </Text>
                        </View>
                      )}
                      <TouchableOpacity
                        onPress={() => deleteRecording(item.id)}
                        className="p-2 -mr-2"
                      >
                        <Ionicons name="trash-outline" size={20} color="#EF4444" />
                      </TouchableOpacity>
                    </View>
                  </View>
                </TouchableOpacity>

                {/* Playback */}
                <TouchableOpacity
                  onPress={() => playRecording(item)}
                  style={{ backgroundColor: colors.surfaceVariant, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center' }}
                >
                  <View className={`w-10 h-10 rounded-full items-center justify-center ${playingId === item.id ? 'bg-red-500' : ''}`}
                    style={playingId !== item.id ? { backgroundColor: colors.primary } : {}}>
                    <Ionicons
                      name={playingId === item.id ? 'pause' : 'play'}
                      size={18}
                      color="white"
                    />
                  </View>
                  <Text style={{ color: colors.text }} className="font-medium ml-3 flex-1">
                    {playingId === item.id ? 'Playing...' : 'Tap to play'}
                  </Text>
                </TouchableOpacity>

                {/* Expanded details */}
                {isExpanded && (
                  <View style={{ marginTop: 12 }}>
                    {/* Surah mode: per-verse results */}
                    {item.mode === 'surah' && item.surahResults && (
                      <View>
                        {item.surahResults.map((verseResult, idx) => (
                          <View key={idx} style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            paddingVertical: 8,
                            paddingHorizontal: 12,
                            backgroundColor: colors.surfaceVariant,
                            borderRadius: 8,
                            marginBottom: 4
                          }}>
                            <Text style={{ color: colors.textSecondary, fontSize: 13, width: 60 }}>
                              Ayah {verseResult.ayah}
                            </Text>
                            <View style={{ flex: 1, height: 4, backgroundColor: colors.border, borderRadius: 2, marginHorizontal: 8 }}>
                              <View style={{
                                height: 4,
                                backgroundColor: verseResult.accuracy >= 90 ? '#22C55E' : verseResult.accuracy >= 70 ? '#F59E0B' : '#EF4444',
                                borderRadius: 2,
                                width: `${verseResult.accuracy}%`
                              }} />
                            </View>
                            <Text style={{
                              color: verseResult.accuracy >= 90 ? '#22C55E' : verseResult.accuracy >= 70 ? '#F59E0B' : '#EF4444',
                              fontSize: 13,
                              fontWeight: '700',
                              width: 40,
                              textAlign: 'right'
                            }}>
                              {verseResult.accuracy}%
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {/* Verse mode: error list */}
                    {item.mode !== 'surah' && item.errors && item.errors.length > 0 && (
                      <View>
                        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>
                          Errors ({item.errors.length})
                        </Text>
                        {item.errors.slice(0, 5).map((error, idx) => {
                          const display = getErrorTypeDisplay(error.error_type);
                          return (
                            <View key={idx} style={{
                              backgroundColor: colors.surfaceVariant,
                              borderRadius: 8,
                              padding: 10,
                              marginBottom: 4,
                              borderLeftWidth: 3,
                              borderLeftColor: display.color
                            }}>
                              <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>
                                {display.en}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    )}

                    {/* No errors message */}
                    {item.accuracy !== undefined && (!item.errors || item.errors.length === 0) && item.mode !== 'surah' && (
                      <View style={{ alignItems: 'center', padding: 12 }}>
                        <Ionicons name="checkmark-circle" size={24} color="#22C55E" />
                        <Text style={{ color: '#22C55E', fontSize: 13, fontWeight: '500', marginTop: 4 }}>
                          No errors detected
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}