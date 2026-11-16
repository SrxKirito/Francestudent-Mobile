#!/usr/bin/env ruby
# Attach the app privacy manifest to Tauri's generated Xcode project. It must
# live at the application bundle root, not inside Tauri's assets folder.
require 'fileutils'
require 'xcodeproj'

root = File.expand_path('..', __dir__)
generated = File.join(root, 'src-tauri', 'gen', 'apple')
source = File.join(root, 'src-tauri', 'PrivacyInfo.xcprivacy')
projects = Dir.glob(File.join(generated, '*.xcodeproj')).select { |path| File.directory?(path) }
abort 'Projet Xcode Tauri introuvable ou ambigu.' unless projects.length == 1
abort 'Manifeste de confidentialité introuvable.' unless File.file?(source)

FileUtils.cp(source, File.join(generated, 'PrivacyInfo.xcprivacy'))
project = Xcodeproj::Project.open(projects.first)
targets = project.targets.select { |target| target.name.end_with?('_iOS') }
abort 'Cible iOS Tauri introuvable ou ambiguë.' unless targets.length == 1
target = targets.first
group = project.main_group
reference = group.files.find { |file| file.path == 'PrivacyInfo.xcprivacy' } || group.new_file('PrivacyInfo.xcprivacy')
unless target.resources_build_phase.files_references.include?(reference)
  target.resources_build_phase.add_file_reference(reference, true)
end
project.save
puts 'Manifeste de confidentialité ajouté au paquet iOS.'
