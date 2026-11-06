import 'package:forevertracker_sync/queue/queue_store.dart';
import 'package:forevertracker_sync/queue/queued_request.dart';

/// In-memory [QueueStore]: keeps the JSON form, like the files would.
class MemoryQueueStore implements QueueStore {
  final files = <int, Map<String, Object?>>{};

  @override
  Future<List<QueuedRequest>> load() async {
    final seqs = files.keys.toList()..sort();
    return [for (final s in seqs) QueuedRequest.fromJson(files[s]!)];
  }

  @override
  Future<void> add(QueuedRequest request) async => files[request.seq] = request.toJson();

  @override
  Future<void> remove(int seq) async => files.remove(seq);
}
