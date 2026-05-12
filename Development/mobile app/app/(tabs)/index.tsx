import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Picker } from "@react-native-picker/picker";
import { Audio } from "expo-av";
import * as DocumentPicker from "expo-document-picker";
import { useFonts } from "expo-font";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StatusBar,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import quranData from "../../assets/quran.json";
import surahNames from "../../assets/surahNames.json";
import { getErrorTypeDisplay } from "./errorTypes";
import { useTheme } from "../../contexts/ThemeContext";
import { AnalysisResult, TajweedError, analyzeRecitation } from "../../services/api";

interface Recording {
  id: string;
  surah: number;
  ayah: number;
  uri: string;
  date: string;
  surahName: string;
}

export default function Index() {
  const { isDarkMode, toggleTheme, colors } = useTheme();

  // Load custom Quranic font
  const [fontsLoaded] = useFonts({
    'KFGQPCHafsUthmanicScript': require('../../assets/fonts/KFGQPCHafsUthmanicScript.ttf'),
  });

  const [selectedSurah, setSelectedSurah] = useState(1);
  const [selectedAyah, setSelectedAyah] = useState(1);

  // Mode: 'record_verse', 'record_surah', or 'upload'
  const [mode, setMode] = useState<'record_verse' | 'record_surah' | 'upload'>('record_verse');

  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentRecordingUri, setCurrentRecordingUri] = useState<string | null>(null);
  const [tajweedCount, setTajweedCount] = useState(0);

  // Upload mode states
  const [uploadedFile, setUploadedFile] = useState<{ uri: string; name: string; size?: number } | null>(null);

  // New states for API integration
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [transcription, setTranscription] = useState<string | null>(null);

  // Surah mode states
  const [currentSurahAyah, setCurrentSurahAyah] = useState(1);
  const [surahRecordings, setSurahRecordings] = useState<Map<number, string>>(new Map());
  const [surahResults, setSurahResults] = useState<Map<number, AnalysisResult>>(new Map());
  const [surahComplete, setSurahComplete] = useState(false);
  const [pendingAnalyses, setPendingAnalyses] = useState(0);
  const [surahModeActive, setSurahModeActive] = useState(false);
  const pendingRef = useRef(0);

  // Get verse text from quran.json with proper Arabic display
  const getCurrentVerse = () => {
    const verse = (quranData as any)[selectedSurah]?.[selectedAyah];
    return verse?.displayText || "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ";
  };

  const getCurrentSurah = () => {
    return surahNames.find(s => s.number === selectedSurah) || surahNames[0];
  };

  const getAyahCount = () => {
    const surahData = (quranData as any)[selectedSurah];
    return surahData ? Object.keys(surahData).length : 7;
  };

  useEffect(() => {
    (async () => {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
    })();
  }, []);

  useEffect(() => {
    return () => {
      if (recording) recording.stopAndUnloadAsync().catch(() => { });
      if (sound) sound.unloadAsync().catch(() => { });
    };
  }, [recording, sound]);

  const startRecording = async () => {
    try {
      const { recording: newRecording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(newRecording);
      setIsRecording(true);
    } catch (err) {
      Alert.alert("Error", "Failed to start recording");
    }
  };

  const stopRecording = async () => {
    if (!recording) return;
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      setIsRecording(false);
      setCurrentRecordingUri(uri);
      if (uri) {
        await saveRecording(uri);
        // Analyze the recording
        await analyzeRecordingWithAPI(uri);
      }
    } catch (err) {
      console.error("Failed to stop recording", err);
    }
  };

  const analyzeRecordingWithAPI = async (uri: string) => {
    setIsAnalyzing(true);
    setAnalysisResult(null);
    setTranscription(null);

    try {
      const result = await analyzeRecitation(uri, selectedSurah, selectedAyah);

      if (result.success) {
        setAnalysisResult(result);
        setTranscription(result.transcription ?? null);
        setTajweedCount(result.error_count);

        // Update the saved recording with analysis data
        if (currentRecordingUri) {
          const recordings = await AsyncStorage.getItem("recordings");
          if (recordings) {
            const list = JSON.parse(recordings);
            if (list.length > 0 && list[0].uri === currentRecordingUri) {
              list[0].accuracy = result.accuracy;
              list[0].errorCount = result.error_count;
              list[0].errors = result.errors;
              list[0].mode = 'verse';
              await AsyncStorage.setItem("recordings", JSON.stringify(list));
            }
          }
        }

        if (result.accuracy >= 90) {
          Alert.alert("Excellent! 🎉", `Accuracy: ${result.accuracy}%\nYour recitation is very accurate!`);
        } else if (result.accuracy >= 70) {
          Alert.alert("Good Job! 👍", `Accuracy: ${result.accuracy}%\n${result.error_count} areas to improve.`);
        } else {
          Alert.alert("Keep Practicing! 📖", `Accuracy: ${result.accuracy}%\nFound ${result.error_count} areas to work on.`);
        }
      }
    } catch (error) {
      console.error("Analysis failed:", error);
      Alert.alert(
        "Analysis Unavailable",
        "Could not connect to the analysis server. Make sure the backend is running."
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const saveRecording = async (uri: string, analysis?: AnalysisResult) => {
    try {
      const recordings = await AsyncStorage.getItem("recordings");
      const recordingsList = recordings ? JSON.parse(recordings) : [];
      const newRecording = {
        id: Date.now().toString(),
        surah: selectedSurah,
        ayah: selectedAyah,
        uri,
        date: new Date().toISOString(),
        surahName: getCurrentSurah().name,
        accuracy: analysis?.accuracy,
        errorCount: analysis?.error_count,
        errors: analysis?.errors,
        mode: 'verse' as const,
      };
      recordingsList.unshift(newRecording);
      await AsyncStorage.setItem("recordings", JSON.stringify(recordingsList));
      Alert.alert("Success", "Recording saved!");
    } catch (err) {
      Alert.alert("Error", "Failed to save recording");
    }
  };

  const playRecording = async () => {
    if (!currentRecordingUri) {
      Alert.alert("No Recording", "Please record first");
      return;
    }
    try {
      if (isPlaying && sound) {
        await sound.stopAsync();
        await sound.unloadAsync();
        setSound(null);
        setIsPlaying(false);
        return;
      }
      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: currentRecordingUri },
        { shouldPlay: true }
      );
      setSound(newSound);
      setIsPlaying(true);
      newSound.setOnPlaybackStatusUpdate((status: any) => {
        if (status.isLoaded && status.didJustFinish) {
          setIsPlaying(false);
          newSound.unloadAsync();
          setSound(null);
        }
      });
    } catch (err) {
      Alert.alert("Error", "Failed to play recording");
    }
  };

  const handleRecord = async () => {
    if (isRecording) await stopRecording();
    else await startRecording();
  };

  // Upload mode functions
  const pickAudioFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setUploadedFile({
          uri: asset.uri,
          name: asset.name,
          size: asset.size,
        });
        setCurrentRecordingUri(asset.uri);
        setAnalysisResult(null);

        // Unload previous sound
        if (sound) {
          await sound.unloadAsync();
          setSound(null);
        }
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to pick audio file');
    }
  };

  const removeUploadedFile = async () => {
    if (sound) {
      await sound.unloadAsync();
      setSound(null);
    }
    setUploadedFile(null);
    setCurrentRecordingUri(null);
    setIsPlaying(false);
    setAnalysisResult(null);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleModeSwitch = async (newMode: 'record_verse' | 'record_surah' | 'upload') => {
    // Clean up audio when switching modes
    if (sound) {
      await sound.unloadAsync();
      setSound(null);
    }
    if (recording) {
      await recording.stopAndUnloadAsync();
      setRecording(null);
    }

    setMode(newMode);
    setCurrentRecordingUri(null);
    setUploadedFile(null);
    setIsRecording(false);
    setIsPlaying(false);
    setAnalysisResult(null);
    setTranscription(null);
    // Also reset surah mode states
    setCurrentSurahAyah(1);
    setSurahRecordings(new Map());
    setSurahResults(new Map());
    setSurahComplete(false);
    setPendingAnalyses(0);
    setSurahModeActive(false);
    pendingRef.current = 0;
  };

  // === Surah Mode Functions ===
  const startSurahMode = () => {
    setSurahModeActive(true);
    setCurrentSurahAyah(1);
    setSurahRecordings(new Map());
    setSurahResults(new Map());
    setSurahComplete(false);
    setPendingAnalyses(0);
    pendingRef.current = 0;
    setAnalysisResult(null);
  };

  const analyzeSurahVerse = (uri: string, ayahNum: number) => {
    pendingRef.current += 1;
    setPendingAnalyses(prev => prev + 1);
    analyzeRecitation(uri, selectedSurah, ayahNum)
      .then(result => {
        setSurahResults(prev => new Map(prev).set(ayahNum, result));
      })
      .catch(err => {
        console.error(`Ayah ${ayahNum} analysis failed:`, err);
      })
      .finally(() => {
        pendingRef.current -= 1;
        setPendingAnalyses(prev => prev - 1);
      });
  };

  const stopSurahRecording = async () => {
    if (!recording) return;
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      setIsRecording(false);

      if (uri) {
        const ayahNum = currentSurahAyah;
        setSurahRecordings(prev => new Map(prev).set(ayahNum, uri));

        // Send to backend in background (don't await)
        analyzeSurahVerse(uri, ayahNum);

        // Advance to next verse or complete
        const totalAyahs = getAyahCount();
        if (ayahNum >= totalAyahs) {
          setSurahComplete(true);
        } else {
          setCurrentSurahAyah(ayahNum + 1);
        }
      }
    } catch (err) {
      console.error("Failed to stop surah recording", err);
    }
  };

  const handleSurahRecord = async () => {
    if (isRecording) {
      await stopSurahRecording();
    } else {
      await startRecording();
    }
  };

  const getSurahOverallAccuracy = (): number => {
    if (surahResults.size === 0) return 0;
    let total = 0;
    surahResults.forEach(result => {
      total += result.accuracy;
    });
    return Math.round(total / surahResults.size);
  };

  const saveSurahRecording = async () => {
    try {
      const recordings = await AsyncStorage.getItem("recordings");
      const recordingsList = recordings ? JSON.parse(recordings) : [];

      const surahResultsArr: { ayah: number; accuracy: number; errors: TajweedError[] }[] = [];
      surahResults.forEach((result, ayah) => {
        surahResultsArr.push({
          ayah,
          accuracy: result.accuracy,
          errors: result.errors,
        });
      });
      surahResultsArr.sort((a, b) => a.ayah - b.ayah);

      const firstUri = surahRecordings.get(1) || '';
      const newRecording = {
        id: Date.now().toString(),
        surah: selectedSurah,
        ayah: 1,
        uri: firstUri,
        date: new Date().toISOString(),
        surahName: getCurrentSurah().name,
        accuracy: getSurahOverallAccuracy(),
        errorCount: surahResultsArr.reduce((sum, r) => sum + r.errors.length, 0),
        mode: 'surah' as const,
        surahResults: surahResultsArr,
      };
      recordingsList.unshift(newRecording);
      await AsyncStorage.setItem("recordings", JSON.stringify(recordingsList));
      Alert.alert("Success", "Surah recording saved!");
    } catch (err) {
      Alert.alert("Error", "Failed to save surah recording");
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />

      {/* Fixed Header */}
      <View style={{ backgroundColor: colors.bg, paddingTop: 50, paddingBottom: 16, paddingHorizontal: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ width: 40 }} />
          <Text style={{ color: colors.text, fontSize: 24, fontWeight: '700', letterSpacing: 0.5 }}>
            Mujawwad
          </Text>
          <TouchableOpacity onPress={toggleTheme} style={{ padding: 8 }}>
            <Ionicons name={isDarkMode ? "sunny" : "moon"} size={22} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        bounces={true}
      >
        {/* Verse Display Section */}
        <View style={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 32 }}>
          <View style={{
            backgroundColor: colors.surface,
            borderRadius: 20,
            padding: 24,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: isDarkMode ? 0.3 : 0.1,
            shadowRadius: 8,
            elevation: 3,
          }}>
            <View style={{
              backgroundColor: colors.surfaceVariant,
              paddingVertical: 8,
              paddingHorizontal: 16,
              borderRadius: 12,
              alignSelf: 'center',
              marginBottom: 20
            }}>
              <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '600' }}>
                {getCurrentSurah().arabicName} • آية {selectedAyah}
              </Text>
            </View>
            <Text
              style={{
                color: colors.text,
                fontSize: 32,
                lineHeight: 60,
                textAlign: 'center',
                fontWeight: '400',
                writingDirection: 'rtl',
                fontFamily: fontsLoaded ? 'KFGQPCHafsUthmanicScript' : undefined,
              }}
            >
              {getCurrentVerse()}
            </Text>

          </View>
        </View>

        {/* Mode Toggle */}
        <View style={{ paddingHorizontal: 20, marginBottom: 24 }}>
          <View style={{
            flexDirection: 'row',
            backgroundColor: colors.surface,
            borderRadius: 12,
            padding: 4,
            gap: 4
          }}>
            <TouchableOpacity
              onPress={() => handleModeSwitch('record_verse')}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 8,
                backgroundColor: mode === 'record_verse' ? colors.primary : 'transparent',
                alignItems: 'center'
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="mic" size={16} color={mode === 'record_verse' ? 'white' : colors.textSecondary} />
                <Text style={{
                  color: mode === 'record_verse' ? 'white' : colors.textSecondary,
                  fontSize: 13,
                  fontWeight: '600'
                }}>
                  Verse
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleModeSwitch('record_surah')}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 8,
                backgroundColor: mode === 'record_surah' ? colors.primary : 'transparent',
                alignItems: 'center'
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="list" size={16} color={mode === 'record_surah' ? 'white' : colors.textSecondary} />
                <Text style={{
                  color: mode === 'record_surah' ? 'white' : colors.textSecondary,
                  fontSize: 13,
                  fontWeight: '600'
                }}>
                  Surah
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleModeSwitch('upload')}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 8,
                backgroundColor: mode === 'upload' ? colors.primary : 'transparent',
                alignItems: 'center'
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="cloud-upload" size={16} color={mode === 'upload' ? 'white' : colors.textSecondary} />
                <Text style={{
                  color: mode === 'upload' ? 'white' : colors.textSecondary,
                  fontSize: 13,
                  fontWeight: '600'
                }}>
                  Upload
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* Verse Selectors */}
        <View style={{ paddingHorizontal: 20, marginBottom: 24 }}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600', marginBottom: 16 }}>
            Select Verse
          </Text>

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 8, fontWeight: '500' }}>
                Surah
              </Text>
              <View style={{
                backgroundColor: colors.surface,
                borderRadius: 16,
                overflow: 'hidden',
                borderWidth: 1,
                borderColor: colors.border
              }}>
                <Picker
                  selectedValue={selectedSurah}
                  onValueChange={(value: number) => {
                    setSelectedSurah(value);
                    setSelectedAyah(1);
                  }}
                  style={{ height: 50, color: '#000000' }}
                >
                  {surahNames.map((surah) => (
                    <Picker.Item
                      key={surah.number}
                      label={`${surah.number}. ${surah.name}`}
                      value={surah.number}
                      color="#000000"
                    />
                  ))}
                </Picker>
              </View>
            </View>

            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 8, fontWeight: '500' }}>
                Ayah
              </Text>
              <View style={{
                backgroundColor: colors.surface,
                borderRadius: 16,
                overflow: 'hidden',
                borderWidth: 1,
                borderColor: colors.border
              }}>
                <Picker
                  selectedValue={selectedAyah}
                  onValueChange={setSelectedAyah}
                  style={{ height: 50, color: '#000000' }}
                >
                  {Array.from({ length: getAyahCount() }, (_, i) => i + 1).map((num) => (
                    <Picker.Item key={num} label={`${num}`} value={num} color="#000000" />
                  ))}
                </Picker>
              </View>
            </View>
          </View>
        </View>

        {/* Upload Section - Only show in upload mode */}
        {mode === 'upload' && (
          <View style={{ paddingHorizontal: 20, marginBottom: 24 }}>
            <View style={{
              backgroundColor: colors.surface,
              borderRadius: 16,
              padding: 16,
              borderWidth: 1,
              borderColor: colors.border
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                <Ionicons name="cloud-upload-outline" size={20} color={colors.primary} />
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600', marginLeft: 8 }}>
                  Audio File
                </Text>
              </View>

              {!uploadedFile ? (
                <TouchableOpacity
                  style={{
                    borderWidth: 2,
                    borderStyle: 'dashed',
                    borderColor: colors.border,
                    borderRadius: 12,
                    padding: 32,
                    alignItems: 'center'
                  }}
                  onPress={pickAudioFile}
                >
                  <Ionicons name="folder-open-outline" size={48} color={colors.primary} />
                  <Text style={{ color: colors.text, fontSize: 16, fontWeight: '500', marginTop: 12 }}>
                    Tap to select audio file
                  </Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>
                    Supports MP3, WAV, M4A, OGG
                  </Text>
                </TouchableOpacity>
              ) : (
                <View>
                  {/* File Info */}
                  <View style={{
                    backgroundColor: colors.surfaceVariant,
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: 12,
                    borderRadius: 8,
                    marginBottom: 12
                  }}>
                    <View style={{
                      width: 48,
                      height: 48,
                      borderRadius: 24,
                      backgroundColor: colors.primary + '20',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <Ionicons name="musical-notes" size={28} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={{ color: colors.text, fontSize: 14, fontWeight: '500' }} numberOfLines={1}>
                        {uploadedFile.name}
                      </Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                        {uploadedFile.size ? formatFileSize(uploadedFile.size) : 'Unknown size'}
                      </Text>
                    </View>
                    <TouchableOpacity style={{ padding: 4 }} onPress={removeUploadedFile}>
                      <Ionicons name="close-circle" size={24} color="#EF4444" />
                    </TouchableOpacity>
                  </View>

                  {/* Playback Controls */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <TouchableOpacity
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 24,
                        backgroundColor: isPlaying ? '#EF4444' : colors.primary,
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                      onPress={playRecording}
                    >
                      <Ionicons name={isPlaying ? 'pause' : 'play'} size={24} color="white" />
                    </TouchableOpacity>
                    <Text style={{ color: colors.textSecondary, fontSize: 14, flex: 1 }}>
                      {isPlaying ? 'Playing...' : 'Tap to preview'}
                    </Text>
                  </View>

                  {/* Analyze Button - Show when file is uploaded */}
                  <TouchableOpacity
                    onPress={() => currentRecordingUri && analyzeRecordingWithAPI(currentRecordingUri)}
                    disabled={isAnalyzing}
                    style={{
                      backgroundColor: colors.primary,
                      borderRadius: 12,
                      padding: 16,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginTop: 12
                    }}
                  >
                    {isAnalyzing ? (
                      <ActivityIndicator size="small" color="white" />
                    ) : (
                      <Ionicons name={analysisResult ? "refresh" : "analytics"} size={24} color="white" />
                    )}
                    <Text style={{ color: 'white', fontSize: 16, fontWeight: '600', marginLeft: 10 }}>
                      {isAnalyzing ? "Analyzing..." : analysisResult ? "Analyze Again" : "Analyze"}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Surah Recording Mode */}
        {mode === 'record_surah' && (
          <View style={{ paddingHorizontal: 20, marginBottom: 24 }}>
            <View style={{
              backgroundColor: colors.surface,
              borderRadius: 16,
              padding: 16,
              borderWidth: 1,
              borderColor: colors.border
            }}>
              {!surahModeActive ? (
                // Start button
                <TouchableOpacity
                  onPress={startSurahMode}
                  style={{
                    backgroundColor: colors.primary,
                    borderRadius: 12,
                    padding: 20,
                    alignItems: 'center'
                  }}
                >
                  <Ionicons name="play-circle" size={48} color="white" />
                  <Text style={{ color: 'white', fontSize: 18, fontWeight: '700', marginTop: 12 }}>
                    Start Recording Surah
                  </Text>
                  <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, marginTop: 4 }}>
                    {getCurrentSurah().name} ({getAyahCount()} verses)
                  </Text>
                </TouchableOpacity>
              ) : !surahComplete ? (
                // Active recording - verse by verse
                <View>
                  {/* Progress */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '700' }}>
                      Verse {currentSurahAyah} of {getAyahCount()}
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                      {surahRecordings.size} recorded
                    </Text>
                  </View>

                  {/* Progress bar */}
                  <View style={{ height: 6, backgroundColor: colors.surfaceVariant, borderRadius: 3, marginBottom: 20 }}>
                    <View style={{
                      height: 6,
                      backgroundColor: colors.primary,
                      borderRadius: 3,
                      width: `${(surahRecordings.size / getAyahCount()) * 100}%`
                    }} />
                  </View>

                  {/* Current verse text */}
                  <View style={{
                    backgroundColor: colors.surfaceVariant,
                    borderRadius: 12,
                    padding: 16,
                    marginBottom: 16
                  }}>
                    <Text style={{
                      color: colors.text,
                      fontSize: 24,
                      lineHeight: 48,
                      textAlign: 'center',
                      writingDirection: 'rtl',
                      fontFamily: fontsLoaded ? 'KFGQPCHafsUthmanicScript' : undefined,
                    }}>
                      {(quranData as any)[selectedSurah]?.[currentSurahAyah]?.displayText || ''}
                    </Text>
                  </View>

                  {/* Record button for current verse */}
                  <TouchableOpacity
                    onPress={handleSurahRecord}
                    style={{
                      backgroundColor: isRecording ? '#EF4444' : colors.primary,
                      borderRadius: 12,
                      padding: 16,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 10
                    }}
                  >
                    <Ionicons name={isRecording ? "stop" : "mic"} size={24} color="white" />
                    <Text style={{ color: 'white', fontSize: 16, fontWeight: '600' }}>
                      {isRecording ? "Stop Recording" : `Record Verse ${currentSurahAyah}`}
                    </Text>
                  </TouchableOpacity>

                  {/* Pending analyses indicator */}
                  {pendingAnalyses > 0 && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 12, gap: 8 }}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                        Analyzing {pendingAnalyses} verse{pendingAnalyses > 1 ? 's' : ''}...
                      </Text>
                    </View>
                  )}
                </View>
              ) : (
                // Surah complete - show results
                <View>
                  <View style={{ alignItems: 'center', marginBottom: 20 }}>
                    <Ionicons name="checkmark-circle" size={48} color="#22C55E" />
                    <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700', marginTop: 8 }}>
                      Surah Complete!
                    </Text>
                  </View>

                  {pendingAnalyses > 0 ? (
                    <View style={{ alignItems: 'center', padding: 20 }}>
                      <ActivityIndicator size="large" color={colors.primary} />
                      <Text style={{ color: colors.textSecondary, fontSize: 14, marginTop: 12 }}>
                        Waiting for {pendingAnalyses} analysis result{pendingAnalyses > 1 ? 's' : ''}...
                      </Text>
                    </View>
                  ) : (
                    <View>
                      {/* Overall accuracy */}
                      <View style={{
                        backgroundColor: getSurahOverallAccuracy() >= 90 ? '#22C55E' :
                          getSurahOverallAccuracy() >= 70 ? '#F59E0B' : '#EF4444',
                        borderRadius: 12,
                        padding: 16,
                        alignItems: 'center',
                        marginBottom: 16
                      }}>
                        <Text style={{ color: 'white', fontSize: 36, fontWeight: '700' }}>
                          {getSurahOverallAccuracy()}%
                        </Text>
                        <Text style={{ color: 'white', fontSize: 14, fontWeight: '500', opacity: 0.9 }}>
                          Overall Surah Accuracy
                        </Text>
                      </View>

                      {/* Per-verse results */}
                      <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600', marginBottom: 12 }}>
                        Verse Results
                      </Text>
                      {Array.from({ length: getAyahCount() }, (_, i) => i + 1).map(ayahNum => {
                        const result = surahResults.get(ayahNum);
                        const accuracy = result?.accuracy ?? 0;
                        const acColor = accuracy >= 90 ? '#22C55E' : accuracy >= 70 ? '#F59E0B' : '#EF4444';
                        return (
                          <View key={ayahNum} style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            paddingVertical: 10,
                            paddingHorizontal: 12,
                            backgroundColor: colors.surfaceVariant,
                            borderRadius: 8,
                            marginBottom: 6
                          }}>
                            <Text style={{ color: colors.textSecondary, fontSize: 13, width: 60 }}>
                              Ayah {ayahNum}
                            </Text>
                            <View style={{ flex: 1, height: 6, backgroundColor: colors.border, borderRadius: 3, marginHorizontal: 12 }}>
                              <View style={{ height: 6, backgroundColor: acColor, borderRadius: 3, width: `${accuracy}%` }} />
                            </View>
                            <Text style={{ color: acColor, fontSize: 14, fontWeight: '700', width: 45, textAlign: 'right' }}>
                              {result ? `${accuracy}%` : '—'}
                            </Text>
                          </View>
                        );
                      })}

                      {/* Save button */}
                      <TouchableOpacity
                        onPress={saveSurahRecording}
                        style={{
                          backgroundColor: colors.primary,
                          borderRadius: 12,
                          padding: 16,
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 10,
                          marginTop: 16
                        }}
                      >
                        <Ionicons name="save" size={20} color="white" />
                        <Text style={{ color: 'white', fontSize: 16, fontWeight: '600' }}>
                          Save All Results
                        </Text>
                      </TouchableOpacity>

                      {/* Record again */}
                      <TouchableOpacity
                        onPress={startSurahMode}
                        style={{
                          backgroundColor: colors.surfaceVariant,
                          borderRadius: 12,
                          padding: 14,
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 10,
                          marginTop: 8
                        }}
                      >
                        <Ionicons name="refresh" size={20} color={colors.primary} />
                        <Text style={{ color: colors.primary, fontSize: 15, fontWeight: '600' }}>
                          Record Again
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>
        )}

        {/* Tajweed Analysis */}
        <View style={{ paddingHorizontal: 20, marginBottom: 24 }}>
          <View style={{
            backgroundColor: colors.surface,
            borderRadius: 16,
            padding: 16,
            borderWidth: 1,
            borderColor: colors.border
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{
                  backgroundColor: colors.surfaceVariant,
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 12
                }}>
                  <Ionicons name="analytics" size={20} color={colors.primary} />
                </View>
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>
                  Tajweed Analysis
                </Text>
              </View>
              <View style={{
                backgroundColor: tajweedCount === 0 ? '#22C55E' : '#EF4444',
                width: 28,
                height: 28,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Text style={{ color: 'white', fontSize: 12, fontWeight: '700' }}>
                  {tajweedCount}
                </Text>
              </View>
            </View>

            {isRecording && (
              <View style={{
                backgroundColor: isDarkMode ? '#3A1A1A' : '#FEE2E2',
                borderRadius: 12,
                padding: 12,
                marginTop: 12,
                flexDirection: 'row',
                alignItems: 'center'
              }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444', marginRight: 10 }} />
                <Text style={{ color: '#DC2626', fontSize: 13, fontWeight: '500' }}>
                  Recording in progress...
                </Text>
              </View>
            )}

            {isAnalyzing && (
              <View style={{
                backgroundColor: isDarkMode ? '#1A2A3A' : '#EBF5FF',
                borderRadius: 12,
                padding: 12,
                marginTop: 12,
                flexDirection: 'row',
                alignItems: 'center'
              }}>
                <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 10 }} />
                <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '500' }}>
                  Analyzing your recitation...
                </Text>
              </View>
            )}

            {/* Analysis Results */}
            {analysisResult && !isAnalyzing && (
              <View style={{ marginTop: 16 }}>
                {/* Accuracy Score */}
                <View style={{
                  backgroundColor: analysisResult.accuracy >= 90 ? '#22C55E' :
                    analysisResult.accuracy >= 70 ? '#F59E0B' : '#EF4444',
                  borderRadius: 12,
                  padding: 16,
                  alignItems: 'center',
                  marginBottom: 12
                }}>
                  <Text style={{ color: 'white', fontSize: 32, fontWeight: '700' }}>
                    {analysisResult.accuracy}%
                  </Text>
                  <Text style={{ color: 'white', fontSize: 14, fontWeight: '500', opacity: 0.9 }}>
                    Accuracy Score
                  </Text>
                </View>

                {/* Transcription */}
                {transcription && (
                  <View style={{
                    backgroundColor: colors.surfaceVariant,
                    borderRadius: 12,
                    padding: 12,
                    marginBottom: 12
                  }}>
                    <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 4 }}>
                      What we heard:
                    </Text>
                    <Text style={{ color: colors.text, fontSize: 16, textAlign: 'right', lineHeight: 28 }}>
                      {transcription}
                    </Text>
                  </View>
                )}

                {/* Error List */}
                {analysisResult.errors.length > 0 && (
                  <View style={{ marginTop: 8 }}>
                    <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600', marginBottom: 8 }}>
                      Areas to Improve:
                    </Text>
                    {analysisResult.errors.slice(0, 5).map((error, index) => {
                      const errorDisplay = getErrorTypeDisplay(error.error_type);
                      return (
                        <View key={index} style={{
                          backgroundColor: colors.surfaceVariant,
                          borderRadius: 8,
                          padding: 10,
                          marginBottom: 6,
                          flexDirection: 'row',
                          alignItems: 'center',
                          borderLeftWidth: 3,
                          borderLeftColor: errorDisplay.color
                        }}>
                          <Ionicons name="alert-circle" size={18} color={errorDisplay.color} style={{ marginRight: 8 }} />
                          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' }}>
                            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>On </Text>
                            {error.expected && (
                              <Text style={{ color: errorDisplay.color, fontSize: 18, fontWeight: '700', writingDirection: 'rtl', fontFamily: fontsLoaded ? 'KFGQPCHafsUthmanicScript' : undefined }}>
                                {error.expected}
                              </Text>
                            )}
                            {error.word && (
                              <Text style={{ color: colors.textSecondary, fontSize: 12, marginLeft: 6, writingDirection: 'rtl', fontFamily: fontsLoaded ? 'KFGQPCHafsUthmanicScript' : undefined }}>
                                ({error.word})
                              </Text>
                            )}
                            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>, you missed </Text>
                            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>
                              {errorDisplay.en}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}

                {analysisResult.errors.length === 0 && analysisResult.accuracy >= 90 && (
                  <View style={{
                    backgroundColor: isDarkMode ? '#1A3A2A' : '#ECFDF5',
                    borderRadius: 12,
                    padding: 16,
                    alignItems: 'center'
                  }}>
                    <Ionicons name="checkmark-circle" size={32} color="#22C55E" />
                    <Text style={{ color: '#22C55E', fontSize: 14, fontWeight: '600', marginTop: 8 }}>
                      Perfect Recitation! No errors detected.
                    </Text>
                  </View>
                )}

                {analysisResult.accuracy < 90 && analysisResult.errors.length === 0 && (
                  <View style={{
                    backgroundColor: isDarkMode ? '#3A2A1A' : '#FFFBEB',
                    borderRadius: 12,
                    padding: 16,
                    alignItems: 'center'
                  }}>
                    <Ionicons name="fitness" size={32} color="#F59E0B" />
                    <Text style={{ color: '#D97706', fontSize: 14, fontWeight: '600', marginTop: 8, textAlign: 'center' }}>
                      Keep Practicing!
                    </Text>
                    <Text style={{ color: '#D97706', fontSize: 12, marginTop: 4, textAlign: 'center' }}>
                      Your recitation scored {analysisResult.accuracy}%. Try reciting more clearly and slowly.
                    </Text>
                  </View>
                )}

              </View>
            )}
          </View>
        </View>

        {/* Playback - Only show in record mode to avoid duplicate */}
        {mode === 'record_verse' && currentRecordingUri && (
          <View style={{ paddingHorizontal: 20, marginBottom: 24 }}>
            <TouchableOpacity
              onPress={playRecording}
              style={{
                backgroundColor: colors.surface,
                borderRadius: 16,
                padding: 16,
                flexDirection: 'row',
                alignItems: 'center',
                borderWidth: 1,
                borderColor: colors.border
              }}
            >
              <View style={{
                backgroundColor: isPlaying ? '#EF4444' : colors.primary,
                width: 48,
                height: 48,
                borderRadius: 24,
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Ionicons name={isPlaying ? "pause" : "play"} size={24} color="white" />
              </View>
              <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600', marginLeft: 16, flex: 1 }}>
                {isPlaying ? "Playing..." : "Tap to play recording"}
              </Text>
            </TouchableOpacity>

            {/* Analyze Again button - only show after first analysis in record mode */}
            {analysisResult && (
              <TouchableOpacity
                onPress={() => currentRecordingUri && analyzeRecordingWithAPI(currentRecordingUri)}
                disabled={isAnalyzing}
                style={{
                  backgroundColor: colors.surface,
                  borderRadius: 16,
                  padding: 16,
                  flexDirection: 'row',
                  alignItems: 'center',
                  borderWidth: 1,
                  borderColor: colors.border,
                  marginTop: 12,
                  justifyContent: 'center'
                }}
              >
                {isAnalyzing ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name="refresh" size={24} color={colors.primary} />
                )}
                <Text style={{ color: colors.primary, fontSize: 15, fontWeight: '600', marginLeft: 12 }}>
                  {isAnalyzing ? "Analyzing..." : "Analyze Again"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>

      {/* FAB - Right above tab bar - Only show in record_verse mode */}
      {mode === 'record_verse' && (
        <View style={{
          position: 'absolute',
          right: 18,
          bottom: Platform.OS === 'ios' ? 93 : 20,
        }}>
          <TouchableOpacity
            onPress={handleRecord}
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: isRecording ? '#EF4444' : colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 8,
              elevation: 8,
            }}
          >
            <Ionicons name={isRecording ? "stop" : "mic"} size={28} color="white" />
          </TouchableOpacity>
        </View>
      )}

    </View>
  );
}