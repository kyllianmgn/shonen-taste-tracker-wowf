enum QueuedKind { heartbeat, sync }

/// A request that failed (network, 5xx, 429) and waits in the offline queue.
/// [body] is the contract JSON, sent again as is.
class QueuedRequest {
  const QueuedRequest({
    required this.seq,
    required this.kind,
    required this.createdAt,
    required this.body,
  });

  /// Send order: smaller goes first. Kept across restarts.
  final int seq;
  final QueuedKind kind;

  /// When the request was first tried; its age decides the expiry.
  final DateTime createdAt;
  final Map<String, Object?> body;

  Map<String, Object?> toJson() => {
    'version': 1,
    'seq': seq,
    'kind': kind.name,
    'createdAt': createdAt.toUtc().toIso8601String(),
    'body': body,
  };

  /// Throws [FormatException] when a field is missing or mistyped.
  factory QueuedRequest.fromJson(Map<String, Object?> json) {
    final seq = json['seq'];
    final kind = QueuedKind.values.asNameMap()[json['kind']];
    final createdAt = json['createdAt'];
    final body = json['body'];
    if (seq is! int || kind == null || createdAt is! String || body is! Map<String, Object?>) {
      throw const FormatException('not a queued request');
    }
    return QueuedRequest(seq: seq, kind: kind, createdAt: DateTime.parse(createdAt), body: body);
  }

  @override
  String toString() => 'QueuedRequest(#$seq ${kind.name})';
}
