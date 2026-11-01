# Minimal build of upstream GoogCC (libwebrtc checkout in ../../cpp) plus the
# trace replay driver. Abseil comes from the system (find_package(absl)).
cmake_minimum_required(VERSION 3.20)
project(goog_cc_replay CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
find_package(absl REQUIRED)

set(WEBRTC "${CMAKE_CURRENT_SOURCE_DIR}/../../cpp")
include(sources.cmake)
list(TRANSFORM WEBRTC_SOURCES PREPEND "${WEBRTC}/")

# experiments/registered_field_trials.h is generated, as in experiments/BUILD.gn.
set(GEN "${CMAKE_CURRENT_BINARY_DIR}/gen")
find_package(Python3 REQUIRED COMPONENTS Interpreter)
add_custom_command(
  OUTPUT "${GEN}/experiments/registered_field_trials.h"
  COMMAND ${CMAKE_COMMAND} -E make_directory "${GEN}/experiments"
  COMMAND Python3::Interpreter -I "${WEBRTC}/experiments/field_trials.py" header
          --output "${GEN}/experiments/registered_field_trials.h"
  DEPENDS "${WEBRTC}/experiments/field_trials.py")

add_executable(goog_cc_replay replay.cc stubs.cc ${WEBRTC_SOURCES}
  "${GEN}/experiments/registered_field_trials.h")
target_include_directories(goog_cc_replay PRIVATE "${WEBRTC}" "${GEN}")
target_compile_definitions(goog_cc_replay PRIVATE WEBRTC_POSIX WEBRTC_LINUX)
target_compile_options(goog_cc_replay PRIVATE -w)
target_link_libraries(goog_cc_replay PRIVATE
  absl::strings absl::str_format absl::flat_hash_map absl::flat_hash_set
  absl::optional absl::algorithm_container absl::any_invocable absl::nullability
  absl::check absl::log absl::inlined_vector absl::base absl::memory absl::cleanup)
