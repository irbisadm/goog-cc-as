// Link-time stand-ins for pieces of libwebrtc GoogCC does not use.
#include <memory>

#include "api/field_trials_view.h"
#include "api/task_queue/default_task_queue_factory.h"
#include "api/task_queue/task_queue_factory.h"

namespace webrtc {
// The replay driver always provides its own TaskQueueFactory.
std::unique_ptr<TaskQueueFactory> CreateDefaultTaskQueueFactory(const FieldTrialsView*) {
  return nullptr;
}
}  // namespace webrtc
