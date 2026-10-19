import { MaterialIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { getKpiReport, listKpiCameras } from "../utils/alertStorage";

const formatDate = (date) => date.toISOString().slice(0, 10);

export default function KpiReportScreen({ token = null, kpiApiUrl = null }) {
  const [cameras, setCameras] = useState([]);
  const [selectedCameras, setSelectedCameras] = useState([]);
  const [cameraInput, setCameraInput] = useState("");
  const today = formatDate(new Date());
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [startTime, setStartTime] = useState("00:00:00");
  const [endTime, setEndTime] = useState("23:59:59");
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const loadCameras = useCallback(async () => {
    try {
      const values = await listKpiCameras();
      setCameras(values);
      setSelectedCameras((current) => (current.length ? current : values));
    } catch (error) {
      setMessage(`Unable to load cameras: ${error.message}`);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadCameras();
    }, [loadCameras]),
  );

  const toggleCamera = (camera) => {
    setSelectedCameras((current) =>
      current.includes(camera)
        ? current.filter((item) => item !== camera)
        : [...current, camera],
    );
  };

  const addCamera = () => {
    const camera = cameraInput.trim();
    if (!camera) return;
    setCameras((current) =>
      current.includes(camera) ? current : [...current, camera],
    );
    setSelectedCameras((current) =>
      current.includes(camera) ? current : [...current, camera],
    );
    setCameraInput("");
  };

  const search = async () => {
    if (!selectedCameras.length) {
      setMessage("Select at least one camera.");
      return;
    }
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(endDate) ||
      !/^\d{2}:\d{2}:\d{2}$/.test(startTime) ||
      !/^\d{2}:\d{2}:\d{2}$/.test(endTime)
    ) {
      setMessage("Use YYYY-MM-DD dates and HH:mm:ss times.");
      return;
    }
    const from = `${startDate}T${startTime}`;
    const to = `${endDate}T${endTime}`;
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (Number.isNaN(fromDate.valueOf()) || Number.isNaN(toDate.valueOf())) {
      setMessage("Enter valid dates and times.");
      return;
    }
    if (fromDate > toDate) {
      setMessage("End date and time must be after the start.");
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      const results = await getKpiReport({
        cameras: selectedCameras,
        from,
        to,
        token,
        apiUrl: kpiApiUrl,
      });
      setRecords(results);
      if (!results.length)
        setMessage("No KPI records found for this selection.");
    } catch (error) {
      setMessage(
        `Unable to load KPI report: ${error.response?.data?.message || error.message}`,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>KPI Report</Text>
      <Text style={styles.subtitle}>
        Select cameras and a time range to fetch and view KPI records.
      </Text>

      <Text style={styles.label}>Camera</Text>
      <View style={styles.addCameraRow}>
        <TextInput
          value={cameraInput}
          onChangeText={setCameraInput}
          onSubmitEditing={addCamera}
          placeholder="Enter camera name"
          style={styles.cameraInput}
          autoCapitalize="none"
        />
        <TouchableOpacity style={styles.addCameraButton} onPress={addCamera}>
          <MaterialIcons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
      <View style={styles.cameraList}>
        {!cameras.length ? (
          <Text style={styles.hint}>No cameras stored</Text>
        ) : null}
        {cameras.map((camera) => {
          const selected = selectedCameras.includes(camera);
          return (
            <TouchableOpacity
              key={camera}
              style={[styles.cameraChip, selected && styles.cameraChipActive]}
              onPress={() => toggleCamera(camera)}
            >
              <MaterialIcons
                name={selected ? "check-box" : "check-box-outline-blank"}
                size={19}
                color={selected ? "#035faa" : "#94a3b8"}
              />
              <Text
                style={[styles.cameraText, selected && styles.cameraTextActive]}
              >
                {camera}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.formRow}>
        <View style={styles.formHalf}>
          <Text style={styles.label}>Start date</Text>
          <TextInput
            value={startDate}
            onChangeText={setStartDate}
            placeholder="YYYY-MM-DD"
            style={styles.input}
          />
        </View>
        <View style={styles.formHalf}>
          <Text style={styles.label}>End date</Text>
          <TextInput
            value={endDate}
            onChangeText={setEndDate}
            placeholder="YYYY-MM-DD"
            style={styles.input}
          />
        </View>
      </View>
      <View style={styles.formRow}>
        <View style={styles.formHalf}>
          <Text style={styles.label}>Start time</Text>
          <TextInput
            value={startTime}
            onChangeText={setStartTime}
            placeholder="HH:mm:ss"
            style={styles.input}
          />
        </View>
        <View style={styles.formHalf}>
          <Text style={styles.label}>End time</Text>
          <TextInput
            value={endTime}
            onChangeText={setEndTime}
            placeholder="HH:mm:ss"
            style={styles.input}
          />
        </View>
      </View>

      <TouchableOpacity
        style={styles.button}
        onPress={search}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <MaterialIcons name="search" size={20} color="#fff" />
            <Text style={styles.buttonText}>Get KPI Data</Text>
          </>
        )}
      </TouchableOpacity>

      {message ? <Text style={styles.message}>{message}</Text> : null}

      {records.map((record) => (
        <View key={record.record_id} style={styles.card}>
          <Text style={styles.cardTitle}>{record.camera_id}</Text>
          <Text style={styles.value}>Timestamp: {record.timestamp ?? "—"}</Text>
          <Text style={styles.value}>
            {record.object_label}: {record.object_count}
          </Text>
          {record.frame_link ? (
            <Image source={{ uri: record.frame_link }} style={styles.image} />
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, backgroundColor: "#f4f6f9", flexGrow: 1 },
  title: { fontSize: 24, fontWeight: "700", color: "#123b5d", marginBottom: 6 },
  subtitle: { color: "#64748b", marginBottom: 20 },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#334155",
    marginBottom: 6,
    marginTop: 12,
  },
  cameraList: {
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d7dee7",
    padding: 8,
  },
  cameraChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 6,
  },
  cameraChipActive: { backgroundColor: "#eff6ff" },
  cameraText: { color: "#475569" },
  cameraTextActive: { color: "#035faa", fontWeight: "700" },
  hint: { color: "#64748b", padding: 8 },
  formRow: { flexDirection: "row", gap: 10 },
  formHalf: { flex: 1 },
  addCameraRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  cameraInput: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d7dee7",
    padding: 13,
  },
  addCameraButton: {
    width: 48,
    borderRadius: 8,
    backgroundColor: "#035faa",
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d7dee7",
    padding: 13,
  },
  button: {
    marginTop: 20,
    backgroundColor: "#035faa",
    borderRadius: 8,
    padding: 14,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  message: { color: "#b91c1c", marginTop: 16 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 16,
    marginTop: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#123b5d",
    marginBottom: 8,
  },
  value: { color: "#475569", marginTop: 4 },
  sectionTitle: { fontWeight: "700", marginTop: 12, color: "#334155" },
  json: { fontFamily: "monospace", color: "#334155", marginTop: 4 },
  image: {
    width: "100%",
    height: 180,
    borderRadius: 8,
    marginTop: 12,
    backgroundColor: "#e2e8f0",
  },
});
