import 'dart:async';

/// Manual clock and one-shot timers: time only moves in [elapse].
class FakeClock {
  FakeClock([DateTime? start]) : _now = start ?? DateTime.utc(2026, 11, 6, 20);

  DateTime _now;
  final _timers = <_FakeTimer>[];

  DateTime now() => _now;

  Timer timer(Duration delay, void Function() callback) {
    final t = _FakeTimer(_now.add(delay), callback);
    _timers.add(t);
    return t;
  }

  /// Timers not yet fired nor cancelled.
  int get activeTimers => _timers.where((t) => t.isActive).length;

  /// Moves time forward by [duration], firing due timers in order and letting
  /// the async work they start run to completion.
  Future<void> elapse(Duration duration) async {
    final end = _now.add(duration);
    await settle();
    while (true) {
      final due = _timers.where((t) => t.isActive && !t.due.isAfter(end)).toList()
        ..sort((a, b) => a.due.compareTo(b.due));
      if (due.isEmpty) break;
      final next = due.first;
      if (next.due.isAfter(_now)) _now = next.due;
      next.fire();
      await settle();
    }
    _now = end;
    await settle();
  }
}

/// Lets pending microtasks and zero-delay futures run.
Future<void> settle() async {
  for (var i = 0; i < 50; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

class _FakeTimer implements Timer {
  _FakeTimer(this.due, this._callback);

  final DateTime due;
  final void Function() _callback;
  bool _active = true;
  int _tick = 0;

  void fire() {
    _active = false;
    _tick = 1;
    _callback();
  }

  @override
  bool get isActive => _active;

  @override
  int get tick => _tick;

  @override
  void cancel() => _active = false;
}
